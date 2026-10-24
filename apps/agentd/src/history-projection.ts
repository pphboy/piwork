import { publicRunModel, type HistoryResultRef, type HistoryRunSummary } from "@piwork/contracts";
import type { RunRecord, SessionRecord } from "@piwork/work-store";
export function historySessionView(value: SessionRecord) {
  const preference = value.modelPreferenceJson ? JSON.parse(value.modelPreferenceJson) : undefined;
  return { workId:value.workId,sessionId:value.sessionId,createdAt:value.createdAt,updatedAt:value.updatedAt,
    modelPreference:preference?{...publicRunModel(preference),availability:preference.availability ?? "available"}:null,
    thinkingLevel:preference?.thinkingLevel === undefined ? "off" : preference.thinkingLevel,
    source:value.sourceJson?JSON.parse(value.sourceJson):{kind:"chat"} };
}
export function historyRunView(value: RunRecord, snapshot?: string, target?: {entryId:string;blockId?:string}): HistoryRunSummary {
  const states = {accepted:1,running:2,cancelling:3,succeeded:4,failed:5,cancelled:6,interrupted:7};
  const model = value.actualModelJson ? JSON.parse(value.actualModelJson) : undefined;
  const ref: HistoryResultRef = {workId:value.workId,sessionId:value.sessionId,runId:value.runId,content:"result",...(snapshot?{snapshot}:{}),...target};
  const available = "resultBytes" in value ? value.resultBytes !== null : value.finalText !== null;
  return {workId:value.workId,sessionId:value.sessionId,runId:value.runId,submissionKey:value.submissionKey,promptDigest:value.promptDigest,
    state:states[value.state],acceptedAt:value.acceptedAt,startedAt:value.startedAt ?? "",finishedAt:value.finishedAt ?? "",
    earliestAvailableSequence:String(value.earliestAvailableSequence),latestSequence:String(value.latestSequence),
    actualModel:model?publicRunModel(model):null,thinkingLevel:model?.thinkingLevel === undefined?"off":model.thinkingLevel,
    source:value.sourceJson?JSON.parse(value.sourceJson):{kind:"chat"},adoptedExperienceVersion:value.adoptedExperienceVersion ?? 0,
    ...(value.errorJson?{error:JSON.parse(value.errorJson)}:{}),resultRef:available?ref:null};
}
