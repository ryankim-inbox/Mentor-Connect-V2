import * as api from "./generated/api";
import type * as types from "./generated/types";

export * from "./generated/api";
export * from "./generated/types";

// Orval generates request-body names twice: as Zod schemas (values) in
// generated/api.ts and as interfaces (types) in generated/types. Star exports
// can't disambiguate (TS2308), so declare each name locally with both
// meanings merged: the schema as the value, the interface as the type. A name
// added to the OpenAPI spec that collides the same way must be added here.
export const BlockUserBody = api.BlockUserBody;
export type BlockUserBody = types.BlockUserBody;
export const CreateReportBody = api.CreateReportBody;
export type CreateReportBody = types.CreateReportBody;
export const CreateRequestBody = api.CreateRequestBody;
export type CreateRequestBody = types.CreateRequestBody;
export const LoginBody = api.LoginBody;
export type LoginBody = types.LoginBody;
export const RegisterBody = api.RegisterBody;
export type RegisterBody = types.RegisterBody;
export const UpdateRequestBody = api.UpdateRequestBody;
export type UpdateRequestBody = types.UpdateRequestBody;
export const UpdateUserBody = api.UpdateUserBody;
export type UpdateUserBody = types.UpdateUserBody;
