import { Type } from 'typebox';
import { ResourceIdSchema } from './harness.js';
const strict = {additionalProperties:false} as const;
export const WebCredentialsInputSchema = Type.Object({account:Type.String({minLength:1,maxLength:128}),password:Type.String({minLength:1,maxLength:1024})},strict);
export const WebSetupStateSchema = Type.Object({administratorInitialized:Type.Boolean()},strict);
export const WebAdministratorCreatedSchema = Type.Object({created:Type.Literal(true),account:Type.String(),next:Type.Literal('/login')},strict);
export const WebRuntimeDefaultsSchema = Type.Object({agentImage:Type.String({minLength:1,maxLength:4096})},strict);
export const WebRuntimeSelectionInputSchema = Type.Object({modelRef:ResourceIdSchema,agentImage:Type.Optional(Type.String({minLength:1,maxLength:4096}))},strict);
export const ServiceAccessResolutionSchema = Type.Object({hostname:Type.String(),workId:Type.String(),serviceId:Type.String(),port:Type.Integer({minimum:1,maximum:65535}),generation:Type.Optional(Type.String({minLength:1,maxLength:128}))},strict);
