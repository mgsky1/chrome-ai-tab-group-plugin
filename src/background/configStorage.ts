import type { AiConfigStorage, AiProvider } from './aiServive';

const STORAGE_KEY = 'aiConfigStorage';
const PROVIDER_TYPES_STORAGE_KEY = 'providerTypesConfig';

/**
 * 供应商类型信息定义
 */
export type ProviderTypeInfo = {
    name: string;
    baseUrl: string;
};

/**
 * 供应商类型配置
 */
export type ProviderTypesConfig = {
    [key: string]: ProviderTypeInfo;
};

/**
 * 默认供应商类型配置
 */
const DEFAULT_PROVIDER_TYPES: ProviderTypesConfig = {

};

export type ProviderType = string;

/**
 * 加载供应商类型配置
 */
export async function loadProviderTypesConfig(): Promise<ProviderTypesConfig> {
    try {
        const result = await chrome.storage.local.get(PROVIDER_TYPES_STORAGE_KEY);
        if (result[PROVIDER_TYPES_STORAGE_KEY]) {
            return result[PROVIDER_TYPES_STORAGE_KEY] as ProviderTypesConfig;
        }
        // 返回默认配置
        return DEFAULT_PROVIDER_TYPES;
    } catch (error) {
        console.error('加载供应商类型配置失败:', error);
        return DEFAULT_PROVIDER_TYPES;
    }
}

/**
 * 保存供应商类型配置
 */
export async function saveProviderTypesConfig(config: ProviderTypesConfig): Promise<void> {
    try {
        await chrome.storage.local.set({ [PROVIDER_TYPES_STORAGE_KEY]: config });
    } catch (error) {
        console.error('保存供应商类型配置失败:', error);
        throw error;
    }
}

/**
 * 添加新的供应商类型
 */
export async function addProviderType(
    type: string,
    info: ProviderTypeInfo
): Promise<void> {
    const config = await loadProviderTypesConfig();
    if (config[type]) {
        throw new Error(`供应商类型 ${type} 已存在`);
    }
    config[type] = info;
    await saveProviderTypesConfig(config);
}

/**
 * 更新供应商类型
 */
export async function updateProviderType(
    type: string,
    info: ProviderTypeInfo
): Promise<void> {
    const config = await loadProviderTypesConfig();
    if (!config[type]) {
        throw new Error(`供应商类型 ${type} 不存在`);
    }
    config[type] = info;
    await saveProviderTypesConfig(config);
}

/**
 * 删除供应商类型
 */
export async function deleteProviderType(type: string): Promise<void> {
    const providerTypesConfig = await loadProviderTypesConfig();
    if (!providerTypesConfig[type]) {
        throw new Error(`供应商类型 ${type} 不存在`);
    }

    const providerInfo = providerTypesConfig[type];

    // 删除供应商类型
    delete providerTypesConfig[type];
    await saveProviderTypesConfig(providerTypesConfig);

    // 清理该类型下所有已配置的用户信息
    const aiConfig = await loadAiConfig();
    if (providerInfo) {
        // 过滤掉该类型的供应商
        aiConfig.providers = aiConfig.providers.filter(p => p.name !== providerInfo.name);

        // 如果默认供应商被删除，清空默认供应商ID
        if (aiConfig.defaultProviderId &&
            !aiConfig.providers.find(p => p.id === aiConfig.defaultProviderId)) {
            aiConfig.defaultProviderId = undefined;
        }

        await saveAiConfig(aiConfig);
    }
}

/**
 * 获取所有供应商类型
 */
export async function getAllProviderTypes(): Promise<ProviderTypesConfig> {
    return await loadProviderTypesConfig();
}

/**
 * 获取供应商类型信息
 */
export async function getProviderTypeInfo(type: string): Promise<ProviderTypeInfo | null> {
    const config = await loadProviderTypesConfig();
    return config[type] || null;
}

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
        return null;
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
    const providerTypes = await loadProviderTypesConfig();
    const providerInfo = providerTypes[providerType];

    if (!providerInfo) {
        throw new Error(`供应商类型 ${providerType} 不存在`);
    }

    // 检查是否已存在该类型的供应商
    const existingIndex = config.providers.findIndex(p => p.name === providerInfo.name);

    const providerData: Omit<AiProvider, 'id'> = {
        name: providerInfo.name,
        key,
        model,
        baseUrl: providerInfo.baseUrl,
        isDefault,
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
    const providerTypes = await loadProviderTypesConfig();
    const providerInfo = providerTypes[providerType];
    if (!providerInfo) {
        return null;
    }
    return config.providers.find(p => p.name === providerInfo.name) || null;
}

const CUSTOM_DICT_STORAGE_KEY = 'customDictStorage';

/**
 * 加载自定义词库
 */
export async function loadCustomDict(): Promise<string[]> {
    try {
        const result = await chrome.storage.sync.get(CUSTOM_DICT_STORAGE_KEY);
        if (result[CUSTOM_DICT_STORAGE_KEY]) {
            return (result[CUSTOM_DICT_STORAGE_KEY] as { words: string[] }).words || [];
        }
        return [];
    } catch (error) {
        console.error('加载自定义词库失败:', error);
        return [];
    }
}

/**
 * 保存自定义词库
 */
export async function saveCustomDict(words: string[]): Promise<void> {
    try {
        await chrome.storage.sync.set({ [CUSTOM_DICT_STORAGE_KEY]: { words } });
    } catch (error) {
        console.error('保存自定义词库失败:', error);
        throw error;
    }
}