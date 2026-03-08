import * as core from "@actions/core";
import * as github from "@actions/github";
import * as glob from "@actions/glob";
import * as fs from "fs";
import * as path from "path";
import FormData from "form-data";
import fetch, { Response } from "node-fetch";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  thumbnail?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

interface WebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

interface CommitContext {
  commitMessage: string;
  commitUrl: string;
  authorName: string;
  authorUrl: string;
  shortSha: string;
}

interface GlobalContext {
  buildNumber: string;
  branch: string;
  repoName: string;
  repoUrl: string;
  workflowName: string;
  runUrl: string;
}

// ─── Named embed colors ───────────────────────────────────────────────────────

const EMBED_COLORS: Record<string, number> = {
  blue: 0x5865f2,
  green: 0x57f287,
  red: 0xed4245,
  yellow: 0xfee75c,
  purple: 0x9b59b6,
  orange: 0xe67e22,
  white: 0xffffff,
  black: 0x000000,
};

function resolveColor(raw: string): number {
  const lower = raw.trim().toLowerCase();
  if (lower in EMBED_COLORS) return EMBED_COLORS[lower];
  const parsed = parseInt(raw, 10);
  if (!isNaN(parsed)) return parsed;
  core.warning(`Unknown embed_color "${raw}", defaulting to blue.`);
  return EMBED_COLORS.blue;
}

// ─── Template substitution ────────────────────────────────────────────────────

function applyGlobalPlaceholders(template: string, ctx: GlobalContext): string {
  return template
    .replace(/\$\{buildNumber\}/g, ctx.buildNumber)
    .replace(/\$\{branch\}/g, ctx.branch)
    .replace(/\$\{repoName\}/g, ctx.repoName)
    .replace(/\$\{repoUrl\}/g, ctx.repoUrl)
    .replace(/\$\{workflowName\}/g, ctx.workflowName)
    .replace(/\$\{runUrl\}/g, ctx.runUrl);
}

function applyCommitPlaceholders(template: string, ctx: CommitContext): string {
  return template
    .replace(/\$\{commitMessage\}/g, ctx.commitMessage)
    .replace(/\$\{commitUrl\}/g, ctx.commitUrl)
    .replace(/\$\{authorName\}/g, ctx.authorName)
    .replace(/\$\{authorUrl\}/g, ctx.authorUrl)
    .replace(/\$\{shortSha\}/g, ctx.shortSha);
}

// ─── Message splitting ────────────────────────────────────────────────────────

function splitMessage(text: string, maxLen: number, splitChar: string): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Find the last splitChar within the allowed length
    const slice = remaining.slice(0, maxLen);
    const cutAt = slice.lastIndexOf(splitChar);
    const end = cutAt > 0 ? cutAt + splitChar.length : maxLen;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }

  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

// ─── HTTP with retry ──────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  init: Parameters<typeof fetch>[1],
  retryCount: number,
  retryDelayMs: number
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      const delay = retryDelayMs * Math.pow(2, attempt - 1);
      core.info(`Retry attempt ${attempt}/${retryCount} after ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const res = await fetch(url, init);

      // Discord rate limit — wait and retry
      if (res.status === 429) {
        const retryAfter = parseFloat(res.headers.get("retry-after") ?? "1") * 1000;
        core.warning(`Rate limited by Discord. Waiting ${retryAfter}ms before retry.`);
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Discord responded ${res.status}: ${body}`);
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      core.warning(`Webhook attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("All webhook attempts failed.");
}

// ─── Sending ──────────────────────────────────────────────────────────────────

async function sendWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  files: string[],
  retryCount: number,
  retryDelayMs: number
): Promise<void> {
  if (files.length === 0) {
    // Plain JSON post
    await fetchWithRetry(
      webhookUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      retryCount,
      retryDelayMs
    );
    return;
  }

  // Multipart post with file attachments
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (!fs.existsSync(filePath)) {
      core.warning(`File not found, skipping: ${filePath}`);
      continue;
    }
    form.append(`files[${i}]`, fs.createReadStream(filePath), path.basename(filePath));
  }

  await fetchWithRetry(
    webhookUrl,
    { method: "POST", body: form, headers: form.getHeaders() },
    retryCount,
    retryDelayMs
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  try {
    // Inputs
    const webhookUrl = core.getInput("url", { required: true });
    const username = core.getInput("username") || "GitHub Actions";
    const avatarUrl = core.getInput("avatar") || undefined;
    const fileGlob = core.getInput("file");
    const fileAttachMode = core.getInput("file_attach_mode") || "last";
    const messageHeader = core.getInput("message_header");
    const messageCommit = core.getInput("message_commit");
    const useEmbed = core.getInput("use_embed") === "true";
    const embedColor = core.getInput("embed_color") || "blue";
    const embedTitle = core.getInput("embed_title");
    const embedThumbnail = core.getInput("embed_thumbnail");
    const embedFooter = core.getInput("embed_footer");
    const splitLength = parseInt(core.getInput("split_length") || "2000", 10);
    const splitChar = core.getInput("split_char").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    const retryCount = parseInt(core.getInput("retry_count") || "3", 10);
    const retryDelayMs = parseInt(core.getInput("retry_delay_ms") || "1000", 10);
    const suppressErrors = core.getInput("webhook_suppress_errors") === "true";

    // Build global context
    const ctx = github.context;
    const repo = ctx.repo;
    const runNumber = String(ctx.runNumber);
    const branch = ctx.ref.replace("refs/heads/", "");
    const repoName = `${repo.owner}/${repo.repo}`;
    const repoUrl = `https://github.com/${repoName}`;
    const runUrl = `${repoUrl}/actions/runs/${ctx.runId}`;
    const workflowName = ctx.workflow;

    const globalCtx: GlobalContext = {
      buildNumber: runNumber,
      branch,
      repoName,
      repoUrl,
      workflowName,
      runUrl,
    };

    // Resolve commit list
    const commits = (ctx.payload.commits as Array<{
      id: string;
      message: string;
      url: string;
      author: { name: string; username?: string };
    }> | undefined) ?? [];

    // Build per-commit lines
    const commitLines = commits.map((commit) => {
      const commitCtx: CommitContext = {
        commitMessage: commit.message.split("\n")[0], // first line only
        commitUrl: commit.url,
        authorName: commit.author.name,
        authorUrl: commit.author.username
          ? `https://github.com/${commit.author.username}`
          : repoUrl,
        shortSha: commit.id.slice(0, 7),
      };
      return applyCommitPlaceholders(messageCommit, commitCtx);
    });

    // Assemble the full message body
    let header = applyGlobalPlaceholders(messageHeader, globalCtx);
    const commitBlock = commitLines.join("\n");
    const fullMessage = header.replace("%COMMITS%", commitBlock);

    // Resolve file globs
    let matchedFiles: string[] = [];
    if (fileGlob) {
      const globber = await glob.create(fileGlob);
      matchedFiles = await globber.glob();
      if (matchedFiles.length === 0) {
        core.warning(`No files matched the glob pattern: ${fileGlob}`);
      } else {
        core.info(`Matched ${matchedFiles.length} file(s) to attach.`);
      }
    }

    // Split the message into chunks if needed
    const chunks = splitMessage(fullMessage, splitLength, splitChar);
    core.info(`Sending ${chunks.length} message chunk(s) to Discord.`);

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const chunkText = chunks[i];

      // Decide which files (if any) to attach to this chunk
      let attachFiles: string[] = [];
      if (fileAttachMode === "always") attachFiles = matchedFiles;
      else if (fileAttachMode === "last" && isLast) attachFiles = matchedFiles;

      // Build payload
      let payload: WebhookPayload;

      if (useEmbed) {
        const embed: DiscordEmbed = {
          description: chunkText,
          color: resolveColor(embedColor),
          timestamp: new Date().toISOString(),
        };

        if (embedTitle) {
          embed.title = applyGlobalPlaceholders(embedTitle, globalCtx);
        }
        if (embedThumbnail) {
          embed.thumbnail = { url: embedThumbnail };
        }
        if (isLast && embedFooter) {
          embed.footer = { text: applyGlobalPlaceholders(embedFooter, globalCtx) };
        }

        payload = { username, avatar_url: avatarUrl, embeds: [embed] };
      } else {
        payload = { username, avatar_url: avatarUrl, content: chunkText };
      }

      try {
        await sendWebhook(webhookUrl, payload, attachFiles, retryCount, retryDelayMs);
        core.info(`Chunk ${i + 1}/${chunks.length} sent successfully.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (suppressErrors) {
          core.warning(`Webhook failed (suppressed): ${msg}`);
        } else {
          core.setFailed(`Webhook failed: ${msg}`);
          return;
        }
      }
    }

    core.info("All messages sent.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`Action failed: ${msg}`);
  }
}

run();
