import type { Card } from './schema.js';
export type { Card } from './schema.js';
export type PublicCard = Pick<
  Card,
  'id' | 'name' | 'cardType' | 'description' | 'attributes' | 'image'
>;
export type User = { id: string | null; role: 'player' | 'trusted' | 'admin'; name: string };
export type Me = { user: User | null; csrf: string; authMode: 'local' | 'telegram' };
export type Workspace = {
  cards: Card[];
  base: Card[];
  revision: number;
  versions: Record<string, number>;
  release: string;
  changelog: string;
  changelogStamp: string;
};
export type Release = { id: string; title: string; created_at: string };
export type CardHistoryEntry = {
  id: string | number;
  release_id?: string;
  release_title?: string;
  action: string;
  before_data: Partial<Card> | null;
  after_data: Partial<Card> | null;
  created_at: string;
  display_name: string | null;
};
export type Catalog = { cards: PublicCard[]; releases: Release[]; title: string };
export type Proposal = {
  id: string;
  card_id: string | null;
  base: PublicCard | null;
  proposed: PublicCard;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  review_note: string;
  author_name: string;
  created_at: string;
};
export type PdfJob = {
  jobId: string;
  revision: number;
  status: 'running' | 'ready' | 'failed';
  pages?: number;
  url?: string;
  error?: string;
};
