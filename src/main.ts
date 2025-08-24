import * as core from '@actions/core'
import * as github from '@actions/github'

import { fmt, send } from './util'

type Commit = { author: { name: string; username: any }; message: string; url: string }

type CommitFormat = {
    authorName: string,
    authorUrl: string,
    commitUrl: string,
    commitMessage: string,
}

function fmtCommit(format: string, commit: Commit): string[] {
    return commit.message.split(/\r?\n|\r/).map(v => v.trim()).filter(Boolean)
        .map(message => fmt<CommitFormat>(format, { 
            authorName: commit.author.name,
            authorUrl: `https://github.com/${commit.author.username}`,
            commitUrl: commit.url,
            commitMessage: message,
        }));
}

export async function run() {
    const mode = core.getInput('mode');
    let msgHeader = core.getInput('message_header');
    // Remove all occurrences of %COMMIT% from message_header
    msgHeader = msgHeader.replace(/%COMMIT%/g, '');
    msgHeader = msgHeader.replace(/%COMMITS%/g, '');
    const msgPart = core.getInput(`message_${mode}`);
    let message = msgHeader;
    if (mode === 'commit') {
        const commits: Commit[] = github.context.payload.commits;
        commits.flatMap(commit => fmtCommit(msgPart, commit)).forEach(v => message += '\n' + v);
    }
    const url = core.getInput('url');
    const username = core.getInput('username');
    const avatar = core.getInput('avatar');
    const file = core.getInput('file');

    // New customizability options
    const splitLength = parseInt(core.getInput('split_length') || '2000', 10);
    const splitChar = core.getInput('split_char') || '\n';
    const fileAttachMode = core.getInput('file_attach_mode') as 'always' | 'last' | 'never' || 'last';
    const suppressErrors = (core.getInput('webhook_suppress_errors') || 'false').toLowerCase() === 'true';

    try {
        await send(url, username, avatar, message, file, {
            splitLength,
            splitChar,
            fileAttachMode,
            suppressErrors,
        });
    } catch (e) {
        core.setFailed(e as Error);
    }
}
