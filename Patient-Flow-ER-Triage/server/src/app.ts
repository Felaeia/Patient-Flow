import Fastify, { LogController, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { permit, type Actor, type Authenticate, type Permission } from "./auth.js";
import { ApiError } from "./errors.js";
import { Repository } from "./repository.js";
import { service } from "./service.js";
import * as v from "./validation.js";

export async function buildApp(pool: Pool, authenticate: Authenticate, options: { origins?: string[]; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false, logController: new LogController({ disableRequestLogging: true }), requestIdHeader: false, genReqId: () => randomUUID(), bodyLimit: 32_768 });
  await app.register(cors, { origin: options.origins ?? [], methods: ["GET", "POST", "PATCH"], allowedHeaders: ["Authorization", "Content-Type"] });
  await app.register(swagger, { openapi: {
    info: { title: "TriFlow API", version: "1.0.0" },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
  } });
  const actors = new WeakMap<FastifyRequest, Actor>();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id).header("cache-control", "no-store");
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info({ method: request.method, route: request.routeOptions.url, status: reply.statusCode, ms: reply.elapsedTime }, "Request completed");
  });

  function sendError(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string, details?: unknown) {
    return reply.code(status).send({ status, code, message, requestId: request.id, details });
  }
  app.setNotFoundHandler((request, reply) => sendError(reply, request, 404, "NOT_FOUND", "Route was not found"));
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
    if (error instanceof z.ZodError) {
      return sendError(reply, request, 400, "INVALID_INPUT", "Request validation failed",
        error.issues.map(({ path, code }) => ({ field: path.join("."), code })));
    }
    if (error instanceof ApiError) return sendError(reply, request, error.status, error.code, error.message);
    if (["23505", "23514", "23503", "40P01", "40001"].includes(error.code ?? "")) {
      return sendError(reply, request, 409, "CONFLICT", "Request conflicts with current data");
    }
    if (["22007", "22008", "22P02", "22021"].includes(error.code ?? "")) {
      return sendError(reply, request, 400, "INVALID_INPUT", "Request contains an invalid value");
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return sendError(reply, request, error.statusCode, "INVALID_REQUEST", "Request could not be parsed");
    }
    request.log.error("Request failed");
    return sendError(reply, request, 500, "INTERNAL_ERROR", "Request could not be completed");
  });
  app.get("/health", async () => ({ data: { status: "ok" } }));
  app.get("/ready", async () => {
    try { await new Repository(pool).ready(); }
    catch { throw new ApiError(503, "NOT_READY", "Database is unavailable or migrations are pending"); }
    return { data: { status: "ready" } };
  });
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  type Svc = ReturnType<typeof service>;
  const empty = z.strictObject({});
  function route<T extends z.ZodType = typeof empty>(
    method: "GET" | "POST" | "PATCH", path: string, permission: Permission,
    handler: (svc: Svc, context: { id: string; query: z.output<typeof v.listQuery>; body: z.output<T>; actor: Actor }) => unknown,
    config: { body?: T; list?: boolean; create?: boolean } = {},
  ) {
    const param = /:(\w+)/.exec(path)?.[1];
    const params = param ? z.strictObject({ [param]: v.id }) : empty;
    const query = config.list ? v.listQuery : empty;
    const document = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", target: "draft-7", unrepresentable: "any" });
    const status = config.create ? 201 : 200;
    const error = { type: "object", required: ["status", "code", "message", "requestId"], properties: {
      status: { type: "integer" }, code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" },
      details: { type: "array", items: { type: "object", additionalProperties: true } },
    } };
    app.route({
      method, url: "/api/v1" + path,
      schema: {
        security: [{ bearer: [] }], ...(param && { params: document(params) }),
        ...(config.list && { querystring: document(query) }), ...(config.body && { body: document(config.body) }),
        response: { [status]: { type: "object", required: ["data"], properties: { data: {} } },
          400: error, 401: error, 403: error, 404: error, 409: error, 500: error },
      },
      validatorCompiler: () => () => true,
      onRequest: async (request) => {
        const actor = await authenticate(request.headers.authorization);
        if (!actor) throw new ApiError(401, "UNAUTHENTICATED", "A valid bearer credential is required");
        permit(actor, permission);
        actors.set(request, actor);
      },
      handler: async (request, reply) => {
        const actor = actors.get(request)!;
        const parsed = params.parse(request.params ?? {}) as Record<string, string>;
        const data = await handler(service(pool, actor), {
          id: param ? parsed[param] : "", query: query.parse(request.query),
          body: (config.body ?? empty).parse(request.body === undefined ? {} : request.body) as z.output<T>, actor,
        });
        return reply.code(status).send({ data });
      },
    });
  }
  route("GET", "/me", "read", (_, { actor }) => actor);
  route("GET", "/dashboard", "read", (s) => s.dashboard());
  route("GET", "/events", "records", (s, { query }) => s.list("event_logs", query), { list: true });
  route("GET", "/patients", "records", (s, { query }) => s.list("patient_records", query), { list: true });
  route("POST", "/patients", "register", (s, { body }) => s.register(body), { body: v.registration, create: true });
  route("GET", "/patients/:patientId", "records", (s, { id, query }) => s.details(id, query), { list: true });
  route("PATCH", "/patients/:patientId", "register", (s, { id, body }) => s.updatePatient(id, body), { body: v.patch(v.patient) });
  route("POST", "/patients/:patientId/encounters", "register", (s, { id, body }) => s.returnPatient(id, body.chief_complaint), { body: v.visit, create: true });
  route("GET", "/patients/:patientId/encounters", "records", (s, { id, query }) => s.list("encounters", query, id), { list: true });
  route("GET", "/encounters/:encounterId", "records", (s, { id }) => s.get("encounters", id));
  route("POST", "/encounters/:encounterId/triage", "triage", (s, { id, body }) => s.triage(id, body), {
    body: z.strictObject({ esi: v.priority, notes: z.string().trim().max(2000).optional() }), create: true,
  });
  route("GET", "/queues", "read", (s, { query }) => s.list("patient_queues", query), { list: true });
  route("PATCH", "/queues/:queueId", "triage", (s, { id, body }) => s.prioritize(id, body.priority), { body: z.strictObject({ priority: v.priority }) });
  route("POST", "/encounters/:encounterId/bay-assignment", "allocate", (s, { id, body }) => s.assignBay(id, body.bay_id), {
    body: z.strictObject({ bay_id: v.id }), create: true,
  });
  route("POST", "/encounters/:encounterId/staff-assignments", "allocate", (s, { id, body }) => s.assignStaff(id, body.staff_id), {
    body: z.strictObject({ staff_id: v.id }), create: true,
  });
  route("POST", "/encounters/:encounterId/discharge", "allocate", (s, { id, body }) => s.discharge(id, body.disposition ?? "discharged"), {
    body: z.strictObject({ disposition: z.enum(["discharged", "admitted"]).optional() }),
  });
  route("POST", "/assignments/:assignmentId/release", "allocate", (s, { id }) => s.releaseAssignment(id));

  route("GET", "/treatment-bays", "read", (s, { query }) => s.list("treatment_bays", query), { list: true });
  route("POST", "/treatment-bays", "manageBay", (s, { body }) => s.save("treatment_bays", undefined, body), { body: v.bay, create: true });
  route("PATCH", "/treatment-bays/:bayId", "manageBay", (s, { id, body }) => s.save("treatment_bays", id, body), { body: v.patch(v.bay) });

  route("GET", "/staff", "records", (s, { query }) => s.list("staff", query), { list: true });
  route("GET", "/staff/:staffId", "records", (s, { id }) => s.get("staff", id));
  route("POST", "/staff", "manageStaff", (s, { body }) => s.save("staff", undefined, body), { body: v.staff, create: true });
  route("PATCH", "/staff/:staffId", "manageStaff", (s, { id, body }) => s.save("staff", id, body), { body: v.patch(v.staff) });

  route("GET", "/resources", "records", (s, { query }) => s.list("resources", query), { list: true });
  route("GET", "/resources/:resourceId", "records", (s, { id }) => s.get("resources", id));
  route("POST", "/resources", "manageResource", (s, { body: { reason, ...body } }) => s.save("resources", undefined, body, reason), { body: v.resource, create: true });
  route("PATCH", "/resources/:resourceId", "manageResource", (s, { id, body: { reason, ...body } }) => s.save("resources", id, body, reason), { body: v.patch(v.resource) });
  route("POST", "/resources/:resourceId/adjustments", "manageResource", (s, { id, body }) => s.adjust(id, body.delta, body.reason), { body: v.adjustment });
  route("GET", "/notifications", "read", (s, { query }) => s.list("notifications", query), { list: true });
  route("PATCH", "/notifications/:notificationId/read", "read", (s, { id }) => s.readNotification(id));
  route("GET", "/audit-logs", "audit", (s, { query }) => s.list("audit_logs", query), { list: true });
  return app;
}
