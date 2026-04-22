// Types shared between main and preload/renderer.
// Keep this file dependency-free (no Node, no DOM imports).

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  mime: string;
  createdAt: string;
}

export interface VaultStatus {
  unlocked: boolean;
  guildId: string | null;
  guildName: string | null;
  premiumTier: 0 | 1 | 2 | 3 | null;
  chunkSize: number | null;
}

export interface UploadProgress {
  uploadId: string;
  name: string;
  bytesUploaded: number;
  total: number;
  chunksComplete: number;
  chunksTotal: number;
  state: "queued" | "encrypting" | "uploading" | "indexing" | "done" | "error" | "cancelled";
  error?: string;
}

export interface DownloadProgress {
  downloadId: string;
  name: string;
  bytesDownloaded: number;
  total: number;
  state: "fetching" | "decrypting" | "writing" | "done" | "error";
  error?: string;
}

export interface OnboardingState {
  step: 1 | 2 | 3 | 4 | 5;
  botTokenValid: boolean;
  botUser: { id: string; username: string; avatarUrl: string | null } | null;
  guildId: string | null;
  guildName: string | null;
  hasExistingVault: boolean;
}

export type IpcRequest =
  | { type: "onboarding.getState" }
  | { type: "onboarding.validateToken"; token: string }
  | { type: "onboarding.startGuildPoll" }
  | { type: "onboarding.stopGuildPoll" }
  | { type: "onboarding.createVault"; passphrase: string }
  | { type: "vault.unlock"; passphrase: string }
  | { type: "vault.lock" }
  | { type: "vault.status" }
  | { type: "vault.list" }
  | { type: "vault.upload"; localPath: string }
  | { type: "vault.download"; fileId: string; destPath: string }
  | { type: "vault.delete"; fileId: string }
  | { type: "vault.changePassphrase"; oldP: string; newP: string }
  | { type: "vault.garbageCollect" }
  | { type: "setup.listBotGuilds" }
  | { type: "setup.initBotAndGuild"; guildId: string }
  | { type: "setup.checkVaultExists" };

export type IpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
