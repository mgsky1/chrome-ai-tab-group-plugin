// Offscreen document：在这里运行 transformers.js
//
// 两个坑都在这里绕开了：
// 1) MV3 的 service worker 禁止 import()，而 onnxruntime-web 必须动态 import wasm 后端，
//    所以推理不能放在 background，只能放在 offscreen 这种普通页面环境。
// 2) @huggingface/transformers 的 web 产物是 webpack 自包含 bundle，如果让 Vite 再打包一次，
//    它内部的 chunk 加载器会被破坏，表现为
//    "no available backend found. ERR: [wasm] TypeError: f is not a function"。
//    因此这里不 import 该包，而是运行时从 public/vendor 里加载原始产物。

const VENDOR_URL = chrome.runtime.getURL('vendor/transformers/transformers.min.js');
const MODEL_ID = 'openai/privacy-filter';

type TextPipeline = (input: string, options?: Record<string, unknown>) => Promise<unknown>;

type TransformersModule = {
    pipeline: (task: string, model?: string, options?: Record<string, unknown>) => Promise<unknown>;
    env: {
        allowRemoteModels: boolean;
        allowLocalModels: boolean;
        backends: { onnx: { wasm?: { wasmPaths?: string; numThreads?: number; proxy?: boolean } } };
    };
};

let modulePromise: Promise<TransformersModule> | null = null;

function loadTransformers(): Promise<TransformersModule> {
    if (!modulePromise) {
        modulePromise = (async () => {
            // 这里的 import() 在 offscreen(普通页面)里是允许的
            const mod = (await import(/* @vite-ignore */ VENDOR_URL)) as TransformersModule;

            const wasm = mod.env.backends.onnx.wasm;
            if (wasm) {
                // 指向扩展内的本地 wasm，避免走 CDN
                wasm.wasmPaths = chrome.runtime.getURL('vendor/transformers/');
                // 扩展环境里 worker 代理和多线程都容易失败，关掉最稳
                wasm.numThreads = 2;
                wasm.proxy = false;
            }
            // 首次会从 Hugging Face 下载模型并缓存
            mod.env.allowRemoteModels = true;
            mod.env.allowLocalModels = false;

            return mod;
        })();
    }
    return modulePromise;
}

// 该模型是 4-bit 块量化的，不同 dtype 对应仓库里不同的权重文件。
// 如果选了仓库中不存在或当前后端算子不全的组合，onnxruntime 会在建会话时报
// "Could not find an implementation for GatherBlockQuantized(1)"。
// 因此按兼容性从高到低依次尝试，直到成功。
const DTYPE_CANDIDATES = ['q4', 'q8', 'fp32'] as const;

type PiiEntity = {
    entity?: string;
    entity_group?: string;
    word?: string;
    score?: number;
};

let extractorPromise: Promise<TextPipeline> | null = null;

function getExtractor(): Promise<TextPipeline> {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await loadTransformers();
            let lastError: unknown = null;

            for (const dtype of DTYPE_CANDIDATES) {
                try {
                    const pipe = (await pipeline('token-classification', MODEL_ID, {
                        device: 'webgpu',
                        dtype: "q4",
                    })) as TextPipeline;
                    console.log(`[offscreen] 模型加载成功，dtype=${dtype}`);
                    return pipe;
                } catch (error) {
                    lastError = error;
                    console.warn(`[offscreen] dtype=${dtype} 加载失败，尝试下一个`, error);
                }
            }
            throw lastError ?? new Error('模型加载失败');
        })();

        // 失败时清掉缓存，下次还能重试
        extractorPromise.catch(() => {
            extractorPromise = null;
        });
    }
    return extractorPromise;
}

async function detectPii(text: string): Promise<PiiEntity[]> {
    const pipe = await getExtractor();
    // 模型输入长度有限（512 token），截断避免报错
    const input = text.slice(0, 2000);

    // token-classification 返回的是实体数组，不存在 summary_text 字段。
    // aggregation_strategy: "simple" 会把 B-/I- 的子词合并成完整实体。
    const out = await pipe(input, { aggregation_strategy: 'simple' });
    return Array.isArray(out) ? (out as PiiEntity[]) : [];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== 'offscreen') return;

    if (message.action === 'detectPii') {
        detectPii(String(message.text ?? ''))
            .then(entities => sendResponse({ success: true, entities }))
            .catch(err => sendResponse({ success: false, error: String(err?.message ?? err) }));
        return true; // 异步响应
    }
});
