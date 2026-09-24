import {
  FLOW_BATCH_RPC,
  buildFlowMediaRequest,
  buildFlowOperationRequest,
  buildFlowProjectMediaRequest,
  findFlowMediaId,
  findFlowMediaIdInText,
  firstFlowBatchPayload,
  readFlowMediaUrls,
  readFlowOperation,
} from './FlowBatchProtocol';

export interface FlowBatchRpcExecutor {
  run(
    rpcId: string,
    fReq: string,
    options?: { match?: string },
  ): Promise<string>;
}

export interface FlowBatchVideoPollResult {
  status: 'PENDING' | 'SUCCESSFUL';
  operationId?: string;
  projectId?: string;
  mediaId?: string;
  url?: string;
  posterUrl?: string;
  complaint?: string;
}

/**
 * Stateful poll coordinator for Flow's migrated batch transport.
 *
 * Flow exposes three eventually-consistent signals for operation-backed video:
 * operation status, project listing, and the media record. The listing is the
 * authority for operation -> mediaId, while the media record is the authority
 * for "video is actually fetchable". A poster-only media record is still
 * pending.
 */
export class FlowBatchVideoPoller {
  private readonly operationProjects = new Map<string, string>();
  private readonly operationMedia = new Map<string, string>();
  private readonly operationPolls = new Map<string, number>();

  constructor(private readonly executor: FlowBatchRpcExecutor) {}

  rememberOperation(operationId: string, projectId: string): void {
    if (!operationId) return;
    if (this.operationProjects.size > 512) {
      this.operationProjects.clear();
      this.operationMedia.clear();
      this.operationPolls.clear();
    }
    this.operationProjects.set(operationId, projectId);
  }

  async pollMedia(mediaId: string, projectId?: string): Promise<FlowBatchVideoPollResult> {
    const raw = await this.executor.run(
      FLOW_BATCH_RPC.MEDIA,
      buildFlowMediaRequest(mediaId),
    );
    const payload = firstFlowBatchPayload(raw, FLOW_BATCH_RPC.MEDIA);
    const urls = readFlowMediaUrls(payload, mediaId);
    if (!urls.video) {
      return {
        status: 'PENDING',
        projectId,
        mediaId,
        posterUrl: urls.image,
      };
    }
    return {
      status: 'SUCCESSFUL',
      projectId,
      mediaId,
      url: urls.video,
      posterUrl: urls.image,
    };
  }

  async pollOperation(
    operationId: string,
    fallbackProjectId?: string,
  ): Promise<FlowBatchVideoPollResult> {
    const cachedMediaId = this.operationMedia.get(operationId);
    if (cachedMediaId) {
      const result = await this.pollMedia(
        cachedMediaId,
        this.operationProjects.get(operationId) ?? fallbackProjectId,
      );
      return { ...result, operationId };
    }

    const round = (this.operationPolls.get(operationId) ?? 0) + 1;
    this.operationPolls.set(operationId, round);

    let projectId = this.operationProjects.get(operationId) ?? fallbackProjectId;
    let complaint: string | undefined;
    let shouldConsultListing = round % 3 === 0;

    try {
      const raw = await this.executor.run(
        FLOW_BATCH_RPC.OPERATION,
        buildFlowOperationRequest(operationId),
      );
      const operation = readFlowOperation(
        firstFlowBatchPayload(raw, FLOW_BATCH_RPC.OPERATION),
      );
      complaint = operation.error;
      projectId = operation.projectId ?? projectId;
      if (projectId) this.rememberOperation(operationId, projectId);
      // CAE is the observed terminal state. A complaint is explicitly not
      // terminal: completed jobs have been observed to complain "Media not found."
      // before the project listing exposes their media id.
      shouldConsultListing = shouldConsultListing
        || operation.status === 'CAE'
        || Boolean(operation.error);
    } catch {
      // Old/decayed operation handles can stop returning useful poll records
      // while the project listing still knows the finished media.
      shouldConsultListing = true;
    }

    if (!shouldConsultListing || !projectId) {
      return {
        status: 'PENDING',
        operationId,
        projectId,
        complaint,
      };
    }

    const mediaId = await this.findMediaId(operationId, projectId);
    if (!mediaId) {
      return {
        status: 'PENDING',
        operationId,
        projectId,
        complaint,
      };
    }

    this.operationMedia.set(operationId, mediaId);
    const result = await this.pollMedia(mediaId, projectId);
    return {
      ...result,
      operationId,
      complaint,
    };
  }

  private async findMediaId(operationId: string, projectId: string): Promise<string | undefined> {
    const raw = await this.executor.run(
      FLOW_BATCH_RPC.PROJECT_MEDIA,
      buildFlowProjectMediaRequest(projectId),
      { match: operationId },
    );

    // FlowBatchPageTransport can return only the ~800-byte match window for
    // the huge project listing. Try the raw scanner first; if an executor
    // returned a complete envelope, parse it as a fallback.
    const fromWindow = findFlowMediaIdInText(raw, operationId);
    if (fromWindow) return fromWindow;

    try {
      return findFlowMediaId(
        firstFlowBatchPayload(raw, FLOW_BATCH_RPC.PROJECT_MEDIA),
        operationId,
      );
    } catch {
      return undefined;
    }
  }
}
