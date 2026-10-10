# AI models

**English** | [简体中文](ai-models.zh-CN.md)

This flow requires matching current Core, Console, Agent and CLI builds. Older fixed images retain their original capabilities; changing a document or restarting an old Agent does not upgrade it. See [existing data and moving Work](#existing-data-and-moving-work) before upgrading.

In Serve UI **AI models**, add a model with **Model ID**, **API type**, **Base URL** and **API Key**. A display name is optional and defaults to the full Model ID. Model IDs and display names support up to 256 characters, including when editing or reading the generated default name. There is no Provider setup or capability JSON step. Each model owns its connection and Key; identical Model IDs can use different connections.

The interfaces are **OpenAI Responses** and **Anthropic Messages**. Responses accepts an API base such as `https://gateway.example.invalid/v1` and appends `/responses`. Messages accepts a service root or a Base URL ending in `/v1`, with or without a trailing slash. Both forms produce one `/v1/messages` path. A gateway path prefix is preserved. Enter a Base URL rather than the full request path. Core requires HTTPS except for loopback HTTP and rejects embedded credentials, query strings and fragments.

## Add, edit and select

Save the complete model once. Enabled models with a Key appear in **Runtime** and **Work Chat → Response settings → Model**, including custom IDs absent from the fixed SDK catalog. The Agent automatically reuses an exact known SDK definition or registers a basic definition for the selected protocol and original custom ID. No template, fuzzy model alias or extra administrator setting is needed. Display names and safe model identifiers distinguish entries with the same Model ID.

Keys are write-only. Leave the edit Key field blank to keep the saved Key; enter a complete replacement to rotate this model's Key. A rotation does not change another model, the selected execution reference or an accepted Run's pinned credential. Keys are absent from browser persistent storage, public Chat/history and errors.

Each model has independent **Enable**, **Disable** and **Delete** actions. Disabling blocks new execution without stopping Work or deleting conversations; requests already sent may complete. Deleting a model used by the Core default or a Work's active/desired configuration requires replacing those dependencies first. Historical replies and unavailable Session preferences remain readable.

Changing the Model ID, protocol or effective endpoint publishes a new selectable execution reference. Equivalent Messages root and `/v1` spellings do not. Existing Work keeps its captured default until the owner explicitly selects and applies a new configuration. A stale Chat override requires explicit reselection. Naming, Test and Key rotation do not change captured model/Thinking facts.

## Message Test

**Test** sends the fixed user message `Reply with OK.` using the current form's Model ID, protocol, address and Key. A saved model can use its existing Key without revealing it; unsaved edits override the saved fields for this Test. Core makes one HTTP request equivalent to curl without installing or executing curl.

The **Model Test** dialog displays the target, sent message, actual assistant reply or safe failure reason, check time and duration. Any nonempty assistant text passes; the reply need not be exactly OK. Reasoning-only, tool-only, empty or incompatible responses fail. Replies are escaped text, limited to 8 KiB and marked if truncated; an echoed known Key is redacted. Core limits the request to 20 seconds and the response to 64 KiB, follows no credential-bearing redirects and retries nothing automatically.

Test is advisory. A remote 404, authentication, network or protocol failure does not block saving, enabling or selecting structurally valid configuration. Test never saves the draft, changes defaults, starts Work or creates a conversation. A successful Test does not confirm streaming, tools or Thinking capabilities.

Validation identifies known fields. **Back to configuration** focuses the affected input and keeps the draft. The dialog distinguishes not started, failed request, unconfirmed result and received reply. Authentication errors from the model endpoint do not sign out the administrator. Core/Console session expiry does.

Closing the dialog keeps the draft; a late response does not reopen it or replace another dialog. **View test result** reopens the existing result without a request. Changing or rereading configuration marks that result stale, including a Test still in flight. **Read current data** and **Configure runtime** are in the page header; **All models** returns from a detail page.

## Runtime, Work and Thinking

Configure an Agent image in **Runtime** and select a model; no second Key is required. Adding a model does not change the default. **Use for future Work** changes the default while preserving other starting settings. Existing Work and Chat overrides remain unchanged. Automatic Service work uses the active Work default rather than the Chat override. The Work default option, response settings and composer show its actual captured Model ID alongside its display name. Renaming or editing the catalog entry does not imply that an existing Work has adopted the new model; explicitly select and Apply a new Work configuration to change that default.

Known models retain their SDK Thinking levels and protocol mappings. No administrator default Thinking setting is added. Unknown/custom IDs have `thinkingAvailability: "unknown"`, no confirmed levels, and **Normal** mode (`thinkingLevel: null`), meaning no additional Thinking was requested. Normal requests omit unconfirmed reasoning/thinking parameters; this does not claim the endpoint's internal reasoning is disabled. New Sessions with an unknown default can send normally without another setup step.

When switching an existing nonempty Thinking preference to an unknown model, explicitly choose **Normal** before saving the complete pair. The old preference is retained until that confirmation; an incompatible pair is rejected atomically. Old records with no Thinking field still mean legacy Off, while new null records retain their distinct meaning through restart, export and import. Automatic Runs with an unknown default also use Normal and do not inherit Chat Thinking.

The new nullable behavior negotiates Chat contract version 3. Existing Work retains its fixed image: use the updated compatible Agent image and explicitly Apply once. Later model additions need no image rebuild or Apply. Older environments reject unsupported records/capabilities and require an upgrade; do not reinterpret Normal as confirmed Off.

## Administrator API

Authenticated administrator endpoints are under `/api/v1/admin`:

- `POST /models`: `{model, api, baseUrl, credential, name?}` creates one complete model atomically.
- `GET /models` and `GET /models/:id`: flat views with `id`, `name`, `model`, `api`, `baseUrl`, `modelRef`, `enabled`, `credentialAvailable`, `createdAt` and `updatedAt`.
- `PATCH /models/:id`: at least one of `model`, `api`, `baseUrl`, `credential`, `name`; omitted Key stays unchanged, blank Key is invalid, empty name resets to Model ID.
- `POST /models/:id/enable`, `POST /models/:id/disable`, `DELETE /models/:id`: independent lifecycle with dependency checks.
- `POST /model-tests`: a complete `{api, baseUrl, model, credential}` draft or `{modelId, api?, baseUrl?, model?, credential?}` using saved values for omitted fields.

Public model DTOs contain no Provider fields, capability JSON or secret material. Ordinary users choose authorized models through Work Chat and cannot use administrator management endpoints. Legacy Provider routes remain compatibility endpoints for existing integrations; the new UI does not use them.

## Existing data and moving Work

On upgrade, each legacy Provider child model becomes an independent model connection, preserving model ID, execution reference, current Key, effective enabled state, default references, captured Work and explicit definitions. A Provider with no models does not create a guessed model. Subsequent model edits and rotations affect only that model. Migration is transactional and idempotent; restarting does not reenable disabled models. The new registry format requires the updated Core. Keep a stopped-installation backup if binary rollback is needed; do not open migrated data with an older Core.

Work packages preserve nonsecret requirements and original Thinking facts, including Normal/null. They do not transfer source model/Provider identities, Keys or live execution grants. Configure corresponding models on the recipient; import uses recipient credentials, stays stopped and never replays history. Ambiguous matches keep history readable and require explicit model selection. Nullable history requires a compatible reader. See [Work snapshots](work-snapshot.md) and [Work packages](work-package-format.md).
