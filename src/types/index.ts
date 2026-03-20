export type UrlStatus =
  | 'pending'
  | 'processing'
  | 'submitted'
  | 'already-indexed'
  | 'error'
  | 'not-eligible';

export interface UrlEntry {
  url: string;
  status: UrlStatus;
  message?: string;
  processedAt?: number;
}

export interface IndexingState {
  sitemapUrl: string;
  urls: UrlEntry[];
  currentIndex: number;
  isRunning: boolean;
  startedAt?: number;
  completedAt?: number;
}

export type MessageType =
  | 'FETCH_SITEMAP'
  | 'START_INDEXING'
  | 'STOP_INDEXING'
  | 'GET_STATE'
  | 'STATE_UPDATE'
  | 'PROCESS_URL'
  | 'URL_RESULT'
  | 'CLEAR_STATE'
  | 'CONTENT_READY';

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface FetchSitemapPayload {
  url: string;
}

export interface ProcessUrlPayload {
  url: string;
  index: number;
}

export interface UrlResultPayload {
  url: string;
  status: UrlStatus;
  message?: string;
}
