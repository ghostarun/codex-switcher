/**
 * Preset list for relay / OpenAI-compatible services.
 *
 * Selecting a preset auto-fills base_url + usage_preset; user only pastes API Key.
 *
 * `usage_preset` matches a built-in Rust fetcher name (see `usage.rs`):
 *   - "openai_compat": GET {base}/v1/usage with Bearer
 *   - "mimo_token_plan": MiMo console Cookie → /api/v1/tokenPlan/usage
 *   - null: skip balance fetch (when relay has no standard usage API)
 *
 * When adding entries: use null for usage_preset unless the relay exposes OpenAI-compatible /v1/usage.
 */
export interface RelayPreset {
    /** Internal id (not shown in UI) */
    id: string;
    /** Default account name (user-editable) */
    name: string;
    /** Required OpenAI-compatible base_url, no trailing slash */
    base_url: string;
    /** Relay homepage (optional, for reference) */
    homepage?: string;
    /** Built-in usage fetcher preset; null = no balance fetch */
    usage_preset?: string | null;
    /** One-line description for UI */
    description?: string;
    /** Model fallback when client model misses the map */
    model_fallback?: string | null;
    /** Model map (key=client model, value=relay model) */
    model_map?: Record<string, string> | null;
    /**
     * Upstream wire format:
     * - "responses" (default) — native codex /v1/responses (Unity2, ChatGPT subset, OpenAI key)
     * - "chat_completions" — only /chat/completions (GLM/MiMo Coding Plan / generic OpenAI Chat); proxy translates
     */
    relay_protocol?: 'responses' | 'chat_completions';
    /** Display: 1–3 char monogram (card icon text) */
    mark?: string;
    /** Display: monogram background color (hex) */
    color?: string;
    /** Display: group in AddRelay card picker */
    group?: 'General relay' | 'CODING PLAN' | 'Third-party models' | 'Custom';
    /** Default API Key prefix (placeholder hint) */
    auth_prefix?: string;
    /**
     * Business category (UI filter chips + inline tags):
     * - `aggregator` — reseller relays (new-api/sub2api/CLIProxyAPI, PinCC/Unity2/FreeModel/PackyCode, etc.)
     * - `coding_plan` — vendor Coding Plan / Token Plan (GLM Coding Plan / MiMo Token Plan / Volcano Coding Plan, etc.)
     * - `third_party` — pay-as-you-go vendor APIs (DeepSeek / Kimi / OpenRouter / Fireworks, etc.)
     */
    category?: 'aggregator' | 'coding_plan' | 'third_party';
}

export const RELAY_PRESETS: RelayPreset[] = [
    {
        id: 'kimi_coding', name: 'Moonshot (Kimi)',
        base_url: 'https://api.kimi.com/coding/v1',
        homepage: 'https://www.kimi.com/code/console',
        usage_preset: 'kimi_coding', relay_protocol: 'responses',
        model_fallback: 'k3-256k', model_map: null,
        description: 'Coding plan: 5H / 7D quota; Kimi Code Key; models per membership',
        mark: 'K', color: '#0F0F10', group: 'CODING PLAN', auth_prefix: 'sk-kimi-', category: 'coding_plan',
    },
    {
        id: 'glm',
        name: 'Zhipu AI',
        base_url: 'https://open.bigmodel.cn/api/paas/v4',
        homepage: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',
        // GLM balance uses its own monitor API (not OpenAI /v1/usage)
        usage_preset: 'glm_zhipu',
        // Map codex models (gpt-5.5 / gpt-4o) GLM does not know to glm-5.1
        // User can override in form (e.g. gpt-4o-mini → glm-5.1-x)
        model_fallback: 'glm-5.1',
        model_map: {
            'gpt-5.5': 'glm-5.1',
            'gpt-5': 'glm-5.1',
            'gpt-5-codex': 'glm-5.1',
            'gpt-4o': 'glm-5',
            'gpt-4o-mini': 'glm-5.1-x',
            'o1': 'glm-5.1',
            'o1-mini': 'glm-5.1-x',
        },
        description: 'Open platform API; OpenAI compatible with model mapping',
        mark: 'GLM', color: '#4F46E5', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'glm_coding',
        name: 'Zhipu AI',
        // GLM Coding plan endpoint (not paas/v4); /chat/completions only
        base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
        homepage: 'https://docs.bigmodel.cn/cn/guide/start/coding-plan',
        usage_preset: 'glm_zhipu',
        relay_protocol: 'chat_completions',
        model_fallback: 'glm-5.1',
        model_map: {
            'gpt-5.5': 'glm-5.1',
            'gpt-5': 'glm-5.1',
            'gpt-5-codex': 'glm-5.1',
            'gpt-4o': 'glm-5',
            'gpt-4o-mini': 'glm-5.1-x',
            'o1': 'glm-5.1',
            'o1-mini': 'glm-5.1-x',
        },
        description: 'GLM Coding Plan (built-in codex /v1/responses ↔ /chat/completions translation)',
        mark: 'GLM', color: '#4F46E5', group: 'CODING PLAN', auth_prefix: 'sk-',
        category: 'coding_plan',
    },
    {
        id: 'mimo_token_plan_sgp',
        name: 'Xiaomi',
        // MiMo Token Plan endpoint; MiMo uses Chat Completions only (not Responses API).
        base_url: 'https://token-plan-sgp.xiaomimimo.com/v1',
        homepage: 'https://platform.xiaomimimo.com/console/plan-manage',
        usage_preset: 'mimo_token_plan',
        relay_protocol: 'chat_completions',
        model_fallback: 'mimo-v2.5-pro',
        model_map: {
            'gpt-5.5': 'mimo-v2.5-pro',
            'gpt-5': 'mimo-v2.5-pro',
            'gpt-5-codex': 'mimo-v2.5-pro',
            'gpt-4o': 'mimo-v2.5-pro',
            'gpt-4o-mini': 'mimo-v2.5-pro',
            'o1': 'mimo-v2.5-pro',
            'o1-mini': 'mimo-v2.5-pro',
        },
        description: 'Token Plan subscription (tp-key; quota via console Cookie)',
        mark: 'Mi', color: '#FF6900', group: 'CODING PLAN', auth_prefix: 'tp-',
        category: 'coding_plan',
    },
    {
        id: 'mimo_api_pay',
        name: 'Xiaomi',
        // MiMo pay-as-you-go endpoint; different base/key from Token Plan.
        base_url: 'https://api.xiaomimimo.com/v1',
        homepage: 'https://platform.xiaomimimo.com/console/api-keys',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'mimo-v2.5-pro',
        model_map: {
            'gpt-5.5': 'mimo-v2.5-pro',
            'gpt-5': 'mimo-v2.5-pro',
            'gpt-5-codex': 'mimo-v2.5-pro',
            'gpt-4o': 'mimo-v2.5-pro',
            'gpt-4o-mini': 'mimo-v2.5-pro',
            'o1': 'mimo-v2.5-pro',
            'o1-mini': 'mimo-v2.5-pro',
        },
        description: 'MiMo pay-as-you-go (sk-key; not Token Plan; billed by usage)',
        mark: 'Mi', color: '#FF6900', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    // ────────────────────────────────────────────────────────────────
    // Type A: generic Responses relays (new-api / sub2api / CLIProxyAPI)
    // User fills base_url + Bearer key.
    // ────────────────────────────────────────────────────────────────
    {
        id: 'generic_responses_relay',
        name: 'General relay',
        base_url: '',
        // "auto" → backend probe_relay_usage_preset:
        //   new-api → /v1/dashboard/billing/* ; sub2api → /v1/usage ; CLIProxyAPI → skip
        usage_preset: 'auto',
        relay_protocol: 'responses',
        model_fallback: 'gpt-5.5',
        description: 'PinCC / PackyCode / AICodeMirror / self-hosted CLIProxyAPI; auto balance probe',
        mark: '⇄', color: '#64748B', group: 'General relay', auth_prefix: 'sk-',
        category: 'aggregator',
    },
    // ────────────────────────────────────────────────────────────────
    // Type B: vendor Coding Plan / Token Plan
    // All use chat_completions translation. Translator fully verified on GLM only;
    // other vendors may need case-by-case fixes in relay_translate.rs.
    // ────────────────────────────────────────────────────────────────
    {
        id: 'deepseek_api',
        name: 'DeepSeek',
        base_url: 'https://api.deepseek.com',
        homepage: 'https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex',
        usage_preset: null,
        relay_protocol: 'responses',
        // Models are selectable independently; never advertise them as GPT aliases.
        model_fallback: 'deepseek-v4-pro',
        model_map: {
            'deepseek-v4-pro': 'deepseek-v4-pro',
            'deepseek-v4-flash': 'deepseek-v4-flash',
            'deepseek-v4-flash-vision-exp': 'deepseek-v4-flash-vision-exp',
        },
        description: 'Native Responses API; official or custom relay; API URL and model ID editable',
        mark: 'DS', color: '#1E40AF', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'moonshot_kimi',
        name: 'Moonshot (Kimi)',
        base_url: 'https://api.moonshot.cn/v1',
        homepage: 'https://platform.kimi.com/docs/guide/codex-kimi',
        usage_preset: null,
        relay_protocol: 'responses',
        model_fallback: 'kimi-k3',
        model_map: null,
        description: 'Open platform native Responses; platform API Key (not Kimi Code subscription key)',
        mark: 'K', color: '#0F0F10', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'minimax_api',
        name: 'MiniMax',
        base_url: 'https://api.minimax.chat/v1',
        homepage: 'https://platform.minimaxi.com/document/',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'MiniMax-M2',
        model_map: {
            'gpt-5.5': 'MiniMax-M2',
            'gpt-5': 'MiniMax-M2',
            'gpt-5-codex': 'MiniMax-M2',
            'gpt-4o': 'MiniMax-M2',
            'gpt-4o-mini': 'MiniMax-M2',
            'o1': 'MiniMax-M2',
            'o1-mini': 'MiniMax-M2',
        },
        description: 'Pay-as-you-go / subscription; OpenAI Chat compatible',
        mark: 'MM', color: '#7C3AED', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'alibaba_dashscope',
        name: 'Alibaba Cloud',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        homepage: 'https://help.aliyun.com/zh/dashscope/',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'qwen3-max',
        model_map: {
            'gpt-5.5': 'qwen3-max',
            'gpt-5': 'qwen3-max',
            'gpt-5-codex': 'qwen3-coder-plus',
            'gpt-4o': 'qwen-plus',
            'gpt-4o-mini': 'qwen-turbo',
            'o1': 'qwen3-max',
            'o1-mini': 'qwen-plus',
        },
        description: 'Bailian open platform; OpenAI compatible mode',
        mark: 'Qw', color: '#FF6A00', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'volcengine_ark',
        name: 'ByteDance',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        homepage: 'https://www.volcengine.com/docs/82379',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        // Volcano Ark model id is ep-xxx from console; placeholder only — set your endpoint id.
        model_fallback: 'doubao-seed-1-6-thinking',
        description: 'Volcano Ark (Coding Plan / Agent Plan / pay-as-you-go); set model to your endpoint id',
        mark: 'Vk', color: '#DC2626', group: 'CODING PLAN', auth_prefix: 'sk-',
        category: 'coding_plan',
    },
    {
        id: 'tencent_hunyuan',
        name: 'Tencent',
        base_url: 'https://api.hunyuan.cloud.tencent.com/v1',
        homepage: 'https://cloud.tencent.com/document/product/1729',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'hunyuan-turbos-latest',
        model_map: {
            'gpt-5.5': 'hunyuan-turbos-latest',
            'gpt-5': 'hunyuan-turbos-latest',
            'gpt-5-codex': 'hunyuan-code',
            'gpt-4o': 'hunyuan-turbos-latest',
            'gpt-4o-mini': 'hunyuan-lite',
            'o1': 'hunyuan-t1-latest',
            'o1-mini': 'hunyuan-t1-latest',
        },
        description: 'Tencent Hunyuan (Token Plan / TokenHub pay-as-you-go); OpenAI Chat compatible',
        mark: 'Hy', color: '#0EA5E9', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'baidu_qianfan',
        name: 'Baidu',
        base_url: 'https://qianfan.baidubce.com/v2',
        homepage: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'ernie-4.5-turbo-128k',
        model_map: {
            'gpt-5.5': 'ernie-4.5-turbo-128k',
            'gpt-5': 'ernie-4.5-turbo-128k',
            'gpt-5-codex': 'ernie-4.5-turbo-128k',
            'gpt-4o': 'ernie-4.5-turbo-128k',
            'gpt-4o-mini': 'ernie-speed-128k',
            'o1': 'ernie-x1-turbo-32k',
            'o1-mini': 'ernie-x1-turbo-32k',
        },
        description: 'Baidu Qianfan / ERNIE (pay-as-you-go / CN subscription)',
        mark: 'Er', color: '#3B82F6', group: 'Third-party models', auth_prefix: 'bce-',
        category: 'third_party',
    },
    {
        id: 'ucloud_modelverse',
        name: 'UCloud',
        base_url: 'https://deepseek.uk-tokyo.ucloud-global.com/v1',
        homepage: 'https://www.ucloud.cn/site/active/modelverse.html',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'glm-4.7',
        description: 'UCloud Modelverse (Coding Plan + pay-as-you-go CN/overseas); multi-model',
        mark: 'U', color: '#0066FF', group: 'CODING PLAN', auth_prefix: 'sk-',
        category: 'coding_plan',
    },
    {
        id: 'fireworks_ai',
        name: 'Fireworks AI',
        base_url: 'https://api.fireworks.ai/inference/v1',
        homepage: 'https://docs.fireworks.ai/',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        // Fireworks model ids like accounts/fireworks/models/glm-4p6
        model_fallback: 'accounts/fireworks/models/glm-4p6',
        model_map: {
            'gpt-5.5': 'accounts/fireworks/models/glm-4p6',
            'gpt-5': 'accounts/fireworks/models/glm-4p6',
            'gpt-5-codex': 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
            'gpt-4o': 'accounts/fireworks/models/llama-v3p3-70b-instruct',
            'gpt-4o-mini': 'accounts/fireworks/models/llama-v3p1-8b-instruct',
        },
        description: 'Fireworks AI inference (pay-as-you-go / Fire Pass); OpenAI Chat compatible',
        mark: 'FW', color: '#7C3AED', group: 'Third-party models', auth_prefix: 'fw-',
        category: 'third_party',
    },
    {
        id: 'stepfun_step',
        name: 'StepFun',
        base_url: 'https://api.stepfun.com/v1',
        homepage: 'https://platform.stepfun.com/docs/',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'step-3',
        model_map: {
            'gpt-5.5': 'step-3',
            'gpt-5': 'step-3',
            'gpt-5-codex': 'step-3',
            'gpt-4o': 'step-2-16k',
            'gpt-4o-mini': 'step-1-flash',
            'o1': 'step-r-mini',
            'o1-mini': 'step-r-mini',
        },
        description: 'StepFun step series (pay-as-you-go / CN / intl subscription)',
        mark: 'St', color: '#0F766E', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        base_url: 'https://openrouter.ai/api/v1',
        homepage: 'https://openrouter.ai/docs',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        // OpenRouter vendor/model; no forced fallback
        model_fallback: 'openai/gpt-5.5',
        description: 'Multi-model API; configurable vendor model IDs',
        mark: 'OR', color: '#10B981', group: 'Third-party models', auth_prefix: 'sk-or-',
        category: 'third_party',
    },
    {
        id: 'aiberm',
        name: 'Aiberm',
        // Aiberm OpenAI + Anthropic; we use OpenAI path. Models depend on token group — probe /v1/models.
        base_url: 'https://aiberm.com/v1',
        homepage: 'https://aiberm.com',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        // Docs show gpt-4 / gpt-3.5-turbo / claude-3-sonnet; models vary by key tier — gpt-4o fallback here
        model_fallback: 'gpt-4o',
        description: 'Aiberm global API (OpenAI/Anthropic; models by token group)',
        mark: 'Ai', color: '#0EA5E9', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'whatai',
        name: 'Whatai relay API',
        // Whatai supports OpenAI + Anthropic; we use OpenAI Chat Completions path.
        base_url: 'https://api.whatai.cc/v1',
        homepage: 'https://api.whatai.cc',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        model_fallback: 'chatgpt-4o-latest',
        model_map: {
            'gpt-5.5': 'chatgpt-4o-latest',
            'gpt-5': 'chatgpt-4o-latest',
            'gpt-5-codex': 'chatgpt-4o-latest',
            'gpt-4o': 'gpt-4o',
            'gpt-4o-mini': 'gpt-4o-mini',
        },
        description: 'Whatai global pay-as-you-go (OpenAI/Anthropic dual protocol)',
        mark: 'Wt', color: '#F59E0B', group: 'Third-party models', auth_prefix: 'sk-',
        category: 'third_party',
    },
    {
        id: 'modelscope',
        name: 'ModelScope (Alibaba)',
        base_url: 'https://api-inference.modelscope.cn/v1',
        homepage: 'https://modelscope.cn/docs/model-service/api-inference/intro',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        // ModelScope vendor/model e.g. Qwen/Qwen3-Max
        model_fallback: 'Qwen/Qwen3-Max',
        model_map: {
            'gpt-5.5': 'Qwen/Qwen3-Max',
            'gpt-5': 'Qwen/Qwen3-Max',
            'gpt-5-codex': 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
            'gpt-4o': 'Qwen/Qwen3-Max',
            'gpt-4o-mini': 'Qwen/Qwen3-Next-80B-A3B-Instruct',
            'o1': 'Qwen/Qwen3-Max',
            'o1-mini': 'Qwen/Qwen3-Next-80B-A3B-Thinking',
        },
        description: 'ModelScope pay-as-you-go; OpenAI Chat compatible (Qwen-focused)',
        mark: 'MS', color: '#624AFF', group: 'Third-party models', auth_prefix: 'ms-',
        category: 'third_party',
    },
    {
        id: 'ollama_local',
        name: 'Ollama (local)',
        base_url: 'http://localhost:11434/v1',
        homepage: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
        usage_preset: null,
        relay_protocol: 'chat_completions',
        // Ollama 0.1.30+ OpenAI-compatible /v1/chat/completions; model = local tag
        model_fallback: 'qwen3:latest',
        description: 'Ollama local (localhost:11434; ollama pull first); any non-empty API Key',
        mark: 'O', color: '#000000', group: 'Third-party models', auth_prefix: 'ollama',
        category: 'third_party',
    },
    {
        id: 'custom',
        name: 'Custom relay',
        base_url: '',
        usage_preset: 'auto',
        description: 'Manual base_url; auto balance probe',
        mark: '+', color: '#64748B', group: 'Custom', auth_prefix: 'sk-',
        category: 'aggregator',
    },
];
