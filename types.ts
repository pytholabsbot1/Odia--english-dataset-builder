
export interface RawArticle {
  id: string;
  url: string;
  headline: string;
  text: string;
  publication_date?: number;
  tags?: string[];
  langCode?: string;
}

export interface TranslationRecord {
  id: string;
  odia: string;
  english: string;
  headline_odia?: string;
  timestamp: number;
}

export enum ProcessStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface LogEntry {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}
