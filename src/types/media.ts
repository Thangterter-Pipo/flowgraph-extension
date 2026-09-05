export type MediaType = "IMAGE" | "VIDEO";

export interface MediaRef {
  provider: "GOOGLE_FLOW";
  mediaId: string;
  type: MediaType;
  projectId?: string;
  workflowId?: string;
  mimeType?: string;
  localArtifact?: string;
}
