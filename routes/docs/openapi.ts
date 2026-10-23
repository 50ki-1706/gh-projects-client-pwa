import { defineHandler } from "void";
import { getOpenApiDocument } from "../../src/api-docs/openapi.ts";

export const GET = defineHandler(() => getOpenApiDocument());
