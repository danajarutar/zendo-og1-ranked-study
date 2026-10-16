import type { StudySession } from "./experiment";

export interface CollectionCheckpoint {
  checkpoint_id: string;
  checkpoint_type: string;
  checkpoint_revision: number;
  trial_index: number | null;
  scene_index: number | null;
  client_timestamp: string;
  session: StudySession;
}

export interface CollectionTransport {
  participantCode: string;
  storageKey: string;
  save(request: CollectionCheckpoint): Promise<void>;
  acknowledgedRevision(): number;
  subscribe(listener: () => void): () => void;
}
