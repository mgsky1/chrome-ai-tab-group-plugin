// background(service worker)侧的 offscreen 调用封装
import { log } from './aiServive';

const OFFSCREEN_PATH = 'src/pages/offscreen/index.html';

let creating: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
    // chrome.offscreen 没有直接查询 API，用 clients 判断更可靠
    if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
            documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
        });
        return contexts.length > 0;
    }
    return false;
}

export async function ensureOffscreenDocument(): Promise<void> {
    if (await hasOffscreenDocument()) return;

    if (creating) {
        await creating;
        return;
    }

    creating = chrome.offscreen
        .createDocument({
            url: OFFSCREEN_PATH,
            reasons: ['WORKERS' as chrome.offscreen.Reason],
            justification: '在页面环境中运行 transformers.js 模型推理（service worker 不支持 import()）',
        })
        .catch((err: unknown) => {
            // 并发创建时可能报已存在，忽略即可
            const msg = String(err);
            if (!msg.includes('Only a single offscreen')) throw err;
        })
        .finally(() => {
            creating = null;
        }) as Promise<void>;

    await creating;
}

export type PiiEntity = {
    entity?: string;
    entity_group?: string;
    word?: string;
    score?: number;
};

/** 调用 offscreen 里的 PII 模型，返回识别出的隐私实体列表 */
export async function detectPiiInOffscreen(text: string): Promise<PiiEntity[]> {
    await ensureOffscreenDocument();
    const res = await chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'detectPii',
        text,
    });
    if (!res?.success) {
        log(`[Offscreen] PII 识别失败: ${res?.error}`);
        return [];
    }
    return (res.entities ?? []) as PiiEntity[];
}
