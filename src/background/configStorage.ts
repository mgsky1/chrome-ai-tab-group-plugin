import type { AiConfigStorage, AiProvider } from './aiServive';

const STORAGE_KEY = 'aiConfigStorage';

/**
 * 供应商类型定义和默认配置
 */
export const PROVIDER_TYPES = {
    openrouter: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        helpUrl: 'https://openrouter.ai/'
    },
    DeepSeek: {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        helpUrl: 'https://api-docs.deepseek.com/zh-cn/'
    }
} as const;

export type ProviderType = keyof typeof PROVIDER_TYPES;

/**
 * 加载AI配置存储
 */
export async function loadAiConfig(): Promise<AiConfigStorage> {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        if (result[STORAGE_KEY]) {
            return result[STORAGE_KEY] as AiConfigStorage;
        }
        // 返回默认空配置
        return {
            providers: [],
            defaultProviderId: undefined
        };
    } catch (error) {
        console.error('加载AI配置失败:', error);
        return {
            providers: [],
            defaultProviderId: undefined
        };
    }
}

/**
 * 保存AI配置存储
 */
export async function saveAiConfig(config: AiConfigStorage): Promise<void> {
    try {
        await chrome.storage.local.set({ [STORAGE_KEY]: config });
    } catch (error) {
        console.error('保存AI配置失败:', error);
        throw error;
    }
}

/**
 * 获取默认供应商配置
 */
export async function getDefaultProvider(): Promise<AiProvider | null> {
    const config = await loadAiConfig();
    if (!config.defaultProviderId) {
        // 如果没有设置默认供应商，返回第一个供应商
        return config.providers.length > 0 ? (config.providers[0] ?? null) : null;
    }
    return config.providers.find(p => p.id === config.defaultProviderId) ?? null;
}

/**
 * 添加或更新供应商（根据供应商类型，如果已存在则更新）
 */
export async function saveProvider(
    providerType: ProviderType,
    key: string,
    model: string,
    isDefault: boolean
): Promise<string> {
    const config = await loadAiConfig();
    const providerInfo = PROVIDER_TYPES[providerType];

    // 检查是否已存在该类型的供应商
    const existingIndex = config.providers.findIndex(p => p.name === providerInfo.name);

    const providerData: Omit<AiProvider, 'id'> = {
        name: providerInfo.name,
        key,
        model,
        baseUrl: providerInfo.baseUrl,
        isDefault
    };

    if (existingIndex !== -1) {
        // 更新现有供应商
        const existingProvider = config.providers[existingIndex];
        if (!existingProvider) {
            throw new Error('供应商配置不存在');
        }
        const id = existingProvider.id;
        config.providers[existingIndex] = {
            ...providerData,
            id
        };

        // 如果设置为默认供应商，清除其他默认标记
        if (isDefault) {
            config.providers.forEach((p, idx) => {
                if (idx !== existingIndex) {
                    p.isDefault = false;
                }
            });
            config.defaultProviderId = id;
        } else if (config.defaultProviderId === id) {
            // 如果取消默认供应商，清空默认供应商ID
            config.defaultProviderId = undefined;
        }

        await saveAiConfig(config);
        return id;
    } else {
        // 添加新供应商
        const id = `provider-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newProvider: AiProvider = {
            ...providerData,
            id
        };

        // 如果设置为默认供应商，清除其他默认标记
        if (newProvider.isDefault) {
            config.providers.forEach(p => p.isDefault = false);
            config.defaultProviderId = id;
        }

        config.providers.push(newProvider);
        await saveAiConfig(config);
        return id;
    }
}
/**
 * 设置默认供应商
 */
export async function setDefaultProvider(id: string): Promise<void> {
    const config = await loadAiConfig();
    const provider = config.providers.find(p => p.id === id);
    if (!provider) {
        throw new Error(`供应商 ${id} 不存在`);
    }

    // 清除所有默认标记
    config.providers.forEach(p => p.isDefault = false);

    // 设置新的默认供应商
    provider.isDefault = true;
    config.defaultProviderId = id;

    await saveAiConfig(config);
}

/**
 * 根据供应商类型获取已配置的供应商
 */
export async function getProviderByType(providerType: ProviderType): Promise<AiProvider | null> {
    const config = await loadAiConfig();
    const providerInfo = PROVIDER_TYPES[providerType];
    return config.providers.find(p => p.name === providerInfo.name) || null;
}

