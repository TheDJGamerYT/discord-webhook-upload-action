import { findFilesToUpload } from './search';

import path from 'path';
import { sendDiscordWebhook, DiscordWebhookOptions } from './webhook';

export function fmt<T extends Record<string, unknown>>(
  template: string,
  values: T
): string {
    return template.replace(/\${([^}]+)}/g, (match, key: string) => {
        const trimmedKey = key.trim();
        return String(values[trimmedKey as keyof T] ?? match); 
    });
}

export interface SplitOptions {
    maxLength?: number;
    char?: string;
    prepend?: string;
    append?: string;
}

export interface SendOptions {
    splitLength?: number;
    splitChar?: string;
    fileAttachMode?: 'always' | 'last' | 'never';
    suppressErrors?: boolean;
}

export async function send(
    url: string,
    name: string,
    avatar: string,
    text: string,
    file: string,
    opts?: SendOptions
) {
    const {
        splitLength = 2000,
        splitChar = '\n',
        fileAttachMode = 'last',
        suppressErrors = false,
    } = opts || {};

    const paths = (await findFilesToUpload(file)).filesToUpload;

    async function sendMessage(message: string, attachFile: boolean) {
        let data: DiscordWebhookOptions = {
            username: name,
            avatar_url: avatar,
            content: message,
        };
        if (attachFile && paths && paths.length > 0) {
            data.files = paths.map(file => ({ name: path.basename(file), data: file }));
        }
        try {
            await sendDiscordWebhook(url, data);
        } catch (e) {
            if (!suppressErrors) throw e;
        }
    }

    if (text.length < splitLength) {
        return await sendMessage(text, fileAttachMode === 'always' || fileAttachMode === 'last');
    }

    const splitText: string[] = splitMessage(text, { maxLength: splitLength, char: splitChar });

    for (let i = 0; i < splitText.length; i++) {
        let attachFile = false;
        if (fileAttachMode === 'always') attachFile = true;
        else if (fileAttachMode === 'last') attachFile = (i === splitText.length - 1);
        await sendMessage(splitText[i], attachFile);
    }
}

function splitMessage(
    text: string,
    options?: SplitOptions
): string[] {
    const {
        maxLength = 2000,
        char = '\n',
        prepend = '',
        append = ''
    } = options || {};
    
    const chunks: string[] = [];
    let currentChunk = prepend;
    
    const lines = text.split(char);
    
    for (const line of lines) {
        if (currentChunk.length + line.length + append.length + char.length > maxLength) {
            if (currentChunk !== prepend) {
                chunks.push(currentChunk + append);
                currentChunk = prepend + line;
            } else if (line.length > maxLength - prepend.length - append.length) {
                const lineChunks = splitLongLine(
                    line, 
                    maxLength - prepend.length - append.length
                );
                
                for (const chunk in lineChunks) {
                    chunks.push(prepend + chunk + append);
                }
                
                currentChunk = prepend;
            } else {
                chunks.push(prepend + line + append);
                currentChunk = prepend;
            }
        } else {
            if (currentChunk !== prepend) {
                currentChunk += char;
            }
            
            currentChunk += line;
        }
    }
    
    if (currentChunk !== prepend) {
        chunks.push(currentChunk + append);
    }
    
    return chunks;
}

function splitLongLine(line: string, maxChunkLength: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    
    while (start < line.length) {
        let end = start + maxChunkLength;
        chunks.push(line.slice(start, end));
        start = end;
    }
    
    return chunks;
}