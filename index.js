import {
    eventSource,
    event_types,
    getRequestHeaders,
    reloadCurrentChat,
    saveSettingsDebounced,
    substituteParams,
    updateMessageBlock,
} from '../../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { secret_state } from '../../../../../secret.js';

// Define provider options
const llmProviders = {
    OPENAI: 'openai',
    CLAUDE: 'claude',
    COHERE: 'cohere',
    GOOGLE: 'google'
};

// Define submodels for each provider
const llmSubmodels = {
    [llmProviders.OPENAI]: [
        { name: 'GPT-4 Turbo', value: 'gpt-4-turbo-preview' },
        { name: 'GPT-4', value: 'gpt-4' },
        { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo-0125' }
    ],
    [llmProviders.CLAUDE]: [
        { name: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
        { name: 'Claude 3 Sonnet', value: 'claude-3-sonnet-20240229' },
        { name: 'Claude 2.1', value: 'claude-2.1' }
    ],
    [llmProviders.COHERE]: [
        { name: 'Command', value: 'command' },
        { name: 'Command Light', value: 'command-light' },
        { name: 'Command Nightly', value: 'command-nightly' }
    ],
    [llmProviders.GOOGLE]: [
        { name: 'Gemini Pro', value: 'gemini-pro' },
        { name: 'Gemini Pro Vision', value: 'gemini-pro-vision' }
    ]
};

const autoModeOptions = {
    NONE: 'none',
    RESPONSES: 'responses',
    INPUT: 'inputs',
    BOTH: 'both'
};

const defaultSettings = {
    provider: llmProviders.OPENAI,
    submodel: llmSubmodels[llmProviders.OPENAI][0].value,
    auto_mode: autoModeOptions.NONE,
    translation_prompt: "You are a highly skilled translator. Translate the following text to {target_language}. Maintain the original meaning, tone, and context. Only respond with the translation, no explanations.\n\nText to translate:\n{text}"
};

// Get API keys from secrets
async function getApiKey(provider) {
    return await secret_state[provider];
}

async function translateWithLLM(text, targetLanguage) {
    try {
        const apiKey = await getApiKey(extension_settings.llm_translate.provider);
        if (!apiKey) {
            throw new Error(`No API key found for ${extension_settings.llm_translate.provider}`);
        }

        const prompt = extension_settings.llm_translate.translation_prompt
            .replace('{target_language}', targetLanguage)
            .replace('{text}', text);

        const response = await fetch('/api/llm/translate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                provider: extension_settings.llm_translate.provider,
                model: extension_settings.llm_translate.submodel,
                prompt: prompt,
                text: text,
                target_language: targetLanguage
            })
        });

        if (!response.ok) {
            throw new Error(`Translation failed: ${response.statusText}`);
        }

        const result = await response.json();
        return result.translation;
    } catch (error) {
        console.error('Translation error:', error);
        toastr.error(error.message, 'Translation Failed');
        return text;
    }
}

async function translateIncomingMessage(messageId) {
    const context = getContext();
    const message = context.chat[messageId];

    if (typeof message.extra !== 'object') {
        message.extra = {};
    }

    const textToTranslate = substituteParams(message.mes, context.name1, message.name);
    const translation = await translateWithLLM(textToTranslate, extension_settings.llm_translate.target_language);
    message.extra.display_text = translation;

    updateMessageBlock(messageId, message);
}

async function translateOutgoingMessage(messageId) {
    const context = getContext();
    const message = context.chat[messageId];

    if (typeof message.extra !== 'object') {
        message.extra = {};
    }

    const originalText = message.mes;
    message.extra.display_text = originalText;
    message.mes = await translateWithLLM(originalText, extension_settings.llm_translate.target_language);
    updateMessageBlock(messageId, message);
}

function loadSettings() {
    // Initialize default settings if not exists
    if (!extension_settings.llm_translate) {
        extension_settings.llm_translate = {};
    }

    for (const key in defaultSettings) {
        if (!Object.hasOwn(extension_settings.llm_translate, key)) {
            extension_settings.llm_translate[key] = defaultSettings[key];
        }
    }

    // Update UI elements
    $('#llm_translation_provider').val(extension_settings.llm_translate.provider);
    $('#llm_translation_prompt').val(extension_settings.llm_translate.translation_prompt);
    updateSubmodels(extension_settings.llm_translate.provider);
    $('#llm_translation_submodel').val(extension_settings.llm_translate.submodel);
}

function updateSubmodels(provider) {
    const $submodelSelect = $('#llm_translation_submodel');
    $submodelSelect.empty();

    const models = llmSubmodels[provider] || [];
    models.forEach(model => {
        $submodelSelect.append(`<option value="${model.value}">${model.name}</option>`);
    });
}

jQuery(async () => {
    // Initialize UI and events
    const html = await renderExtensionTemplateAsync('llm_translate', 'index');
    $('#llm_translation_container').append(html);

    loadSettings();

    // Event handlers
    $('#llm_translation_provider').on('change', function() {
        extension_settings.llm_translate.provider = $(this).val();
        updateSubmodels(extension_settings.llm_translate.provider);
        saveSettingsDebounced();
    });

    $('#llm_translation_submodel').on('change', function() {
        extension_settings.llm_translate.submodel = $(this).val();
        saveSettingsDebounced();
    });

    $('#llm_translation_prompt').on('change', function() {
        extension_settings.llm_translate.translation_prompt = $(this).val();
        saveSettingsDebounced();
    });

    // Register message handlers
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, translateIncomingMessage);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, translateOutgoingMessage);
});
