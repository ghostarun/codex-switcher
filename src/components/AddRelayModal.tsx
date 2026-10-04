import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { ChevronRight } from 'lucide-react';
import { RELAY_PRESETS, RelayPreset } from '../data/relay_presets';
import './AddRelayModal.css';

interface AddRelayModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

const GROUPS: Array<{ id: NonNullable<RelayPreset['group']>; note: string }> = [
    { id: 'General relay', note: 'Third-party relays (new-api / CLIProxyAPI / sub2api), native /v1/responses' },
    { id: 'CODING PLAN', note: 'Vendor coding subscriptions; Responses or Chat Completions per service' },
    { id: 'Third-party models', note: 'Vendor pay-as-you-go APIs (DeepSeek / Kimi / Qwen / OpenRouter, etc.)' },
    { id: 'Custom', note: 'Manual base_url' },
];

function ProviderLogo({ preset, large }: { preset: RelayPreset; large?: boolean }) {
    return (
        <div
            className={`cs-logo${large ? ' cs-logo--lg' : ''}`}
            style={{ background: preset.color ?? '#64748B' }}
            aria-hidden
        >
            {preset.mark ?? preset.name.slice(0, 2)}
        </div>
    );
}

function ProtocolBadge({ proto }: { proto: RelayPreset['relay_protocol'] }) {
    const text = proto === 'chat_completions' ? '/chat/completions' : '/v1/responses';
    return <span className="cs-rbadge cs-rbadge--mono">{text}</span>;
}

function ProviderCard({
    preset,
    selected,
    onSelect,
}: {
    preset: RelayPreset;
    selected: boolean;
    onSelect: (p: RelayPreset) => void;
}) {
    const isSubscription = preset.category === 'coding_plan';
    return (
        <button
            type="button"
            className={`cs-pcard${selected ? ' cs-pcard--selected' : ''}`}
            onClick={() => onSelect(preset)}
        >
            <ProviderLogo preset={preset} />
            <div className="cs-pcard__body">
                <div className="cs-pcard__top">
                    <span className="cs-pcard__name">{preset.name}</span>
                    <div className="cs-pcard__tags">
                        {isSubscription && <span className="cs-rbadge cs-rbadge--sub">Subscription</span>}
                        <ProtocolBadge proto={preset.relay_protocol} />
                    </div>
                </div>
                {preset.description && <div className="cs-pcard__desc">{preset.description}</div>}
            </div>
        </button>
    );
}

function Step1Picker({
    pickedId,
    onPick,
}: {
    pickedId: string | null;
    onPick: (p: RelayPreset) => void;
}) {
    const grouped = useMemo(() => {
        const map = new Map<string, RelayPreset[]>();
        for (const p of RELAY_PRESETS) {
            const key = p.group ?? 'Custom';
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(p);
        }
        return map;
    }, []);

    return (
        <div>
            <div className="cs-relay-tip">
                Pick a <strong>relay service</strong>; base URL auto-filled; next step paste API Key.
                Add the same service multiple times (different account names) to rotate Coding Plan quota.
                Also <code>codexswitch://</code> deep link.
            </div>
            {GROUPS.map((g) => {
                const items = grouped.get(g.id) ?? [];
                if (items.length === 0) return null;
                return (
                    <div key={g.id} className="cs-relay-section">
                        <div className="cs-relay-section__head">
                            <span className="cs-relay-section__title">{g.id}</span>
                            <span className="cs-relay-section__note">{g.note}</span>
                        </div>
                        <div className="cs-relay-grid">
                            {items.map((p) => (
                                <ProviderCard
                                    key={p.id}
                                    preset={p}
                                    selected={pickedId === p.id}
                                    onSelect={onPick}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

interface Step2Props {
    preset: RelayPreset;
    name: string; setName: (v: string) => void;
    baseUrl: string; setBaseUrl: (v: string) => void;
    apiKey: string; setApiKey: (v: string) => void;
    protocol: 'responses' | 'chat_completions'; setProtocol: (v: 'responses' | 'chat_completions') => void;
    usagePreset: string | null; setUsagePreset: (v: string | null) => void;
    usageCookie: string; setUsageCookie: (v: string) => void;
    modelFallback: string; setModelFallback: (v: string) => void;
    modelMapText: string; setModelMapText: (v: string) => void;
    advOpen: boolean; setAdvOpen: (v: boolean) => void;
    onChangeProvider: () => void;
}

function Step2Form(props: Step2Props) {
    const {
        preset,
        name, setName, baseUrl, setBaseUrl, apiKey, setApiKey,
        protocol, setProtocol, usagePreset, setUsagePreset, usageCookie, setUsageCookie,
        modelFallback, setModelFallback, modelMapText, setModelMapText,
        advOpen, setAdvOpen, onChangeProvider,
    } = props;

    const needsCookie = usagePreset === 'mimo_token_plan';
    const keyPlaceholder = `${preset.auth_prefix ?? 'sk-'}••••••••`;

    return (
        <div>
            <div className="cs-selected-card">
                <ProviderLogo preset={preset} large />
                <div className="cs-selected-card__body">
                    <div className="cs-selected-card__top">
                        <span className="cs-selected-card__name">{preset.name}</span>
                        <ProtocolBadge proto={protocol} />
                    </div>
                    <div className="cs-selected-card__url">{baseUrl || '(custom base URL)'}</div>
                    {protocol === 'responses' && modelFallback && (
                        <div className="cs-rfield__hint">After save, pick this relay's models in Codex without switching ChatGPT account.</div>
                    )}
                </div>
                <button type="button" className="cs-selected-card__change" onClick={onChangeProvider}>
                    Change service
                </button>
            </div>

            <div className="cs-rgrid2">
                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-name">
                        Account name<span className="cs-rfield__req">*</span>
                    </label>
                    <input
                        id="cs-relay-name"
                        className="cs-rinput"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Work · GLM Coding"
                    />
                </div>

                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-key">
                        API Key<span className="cs-rfield__req">*</span>
                        <span className="cs-rfield__hint">{preset.auth_prefix ?? 'sk-'}prefix</span>
                    </label>
                    <input
                        id="cs-relay-key"
                        className="cs-rinput cs-rinput--mono"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={keyPlaceholder}
                    />
                </div>

                <div className="cs-rfield cs-rfield--full">
                    <label className="cs-rfield__label" htmlFor="cs-relay-base">
                        API URL (editable)<span className="cs-rfield__req">*</span>
                    </label>
                    <input
                        id="cs-relay-base"
                        className="cs-rinput cs-rinput--mono"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://api.example.com/v1"
                    />
                    <span className="cs-rfield__hint">Preset supplies default URL; for your own relay, set its API URL and key.</span>
                </div>

                {protocol === 'responses' && (
                    <div className="cs-rfield cs-rfield--full">
                        <label className="cs-rfield__label" htmlFor="cs-relay-model">
                            Default model ID (editable)
                        </label>
                        <input id="cs-relay-model" className="cs-rinput cs-rinput--mono"
                            value={modelFallback} onChange={(e) => setModelFallback(e.target.value)}
                            placeholder="Model ID this API supports" />
                        <span className="cs-rfield__hint">Shown in Codex model list; advanced settings can add more models.</span>
                    </div>
                )}

                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-proto">
                        Upstream protocol
                        <span className="cs-rfield__hint">Which wire format the relay speaks</span>
                    </label>
                    <select
                        id="cs-relay-proto"
                        className="cs-rselect"
                        value={protocol}
                        onChange={(e) => setProtocol(e.target.value as 'responses' | 'chat_completions')}
                    >
                        <option value="responses">responses · /v1/responses</option>
                        <option value="chat_completions">chat_completions · /chat/completions</option>
                    </select>
                </div>

                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-usage">
                        Balance fetch
                        <span className="cs-rfield__hint">auto-detect by default</span>
                    </label>
                    <select
                        id="cs-relay-usage"
                        className="cs-rselect"
                        value={usagePreset ?? 'auto'}
                        onChange={(e) => setUsagePreset(e.target.value || null)}
                    >
                        <option value="auto">Auto-detect (recommended · new-api / sub2api)</option>
                        <option value="new_api_dashboard">new_api_dashboard · /v1/dashboard/billing/*</option>
                        <option value="openai_compat">openai_compat · GET /v1/usage</option>
                        <option value="glm_zhipu">glm_zhipu · GLM quota API</option>
                        <option value="kimi_coding">kimi_coding · Kimi coding plan 5H / 7D</option>
                        <option value="mimo_token_plan">mimo_token_plan · requires Cookie</option>
                        <option value="">Do not fetch</option>
                    </select>
                </div>

                {needsCookie && (
                    <div className="cs-rfield cs-rfield--full">
                        <label className="cs-rfield__label" htmlFor="cs-relay-cookie">
                            MiMo quota Cookie
                            <span className="cs-rfield__hint">Copy Cookie header from Network on platform.xiaomimimo.com</span>
                        </label>
                        <textarea
                            id="cs-relay-cookie"
                            className="cs-rtextarea cs-rinput--mono"
                            rows={3}
                            value={usageCookie}
                            onChange={(e) => setUsageCookie(e.target.value)}
                            placeholder="Cookie: api-platform_serviceToken=...; userId=...; api-platform_ph=..."
                            style={{ resize: 'vertical', fontSize: 12 }}
                        />
                    </div>
                )}
            </div>

            <div className="cs-radv">
                <button
                    type="button"
                    className="cs-radv__toggle"
                    onClick={() => setAdvOpen(!advOpen)}
                >
                    <ChevronRight
                        size={14}
                        className={`cs-radv__chevron${advOpen ? ' cs-radv__chevron--open' : ''}`}
                    />
                    Advanced (model fallback / map)
                </button>
                {advOpen && (
                    <div className="cs-radv__body">
                        {protocol !== 'responses' && <div className="cs-rfield">
                            <label className="cs-rfield__label" htmlFor="cs-relay-fallback">
                                Model fallback
                                <span className="cs-rfield__hint">Replace client model when not in map</span>
                            </label>
                            <input
                                id="cs-relay-fallback"
                                className="cs-rinput cs-rinput--mono"
                                value={modelFallback}
                                onChange={(e) => setModelFallback(e.target.value)}
                                placeholder={preset.model_fallback ?? 'empty = pass through'}
                            />
                        </div>}
                        <div className="cs-rfield">
                            <label className="cs-rfield__label" htmlFor="cs-relay-modelmap">
                                Model map
                                <span className="cs-rfield__hint">One line per clientModel=relayModel</span>
                            </label>
                            <textarea
                                id="cs-relay-modelmap"
                                className="cs-rtextarea cs-rinput--mono"
                                rows={4}
                                value={modelMapText}
                                onChange={(e) => setModelMapText(e.target.value)}
                                placeholder={'gpt-5.5=glm-5.1\ngpt-4o=glm-5\ngpt-4o-mini=glm-5.1-x'}
                                style={{ resize: 'vertical', fontSize: 12 }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function parseModelMapText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (k && v) out[k] = v;
    }
    return out;
}

export function AddRelayModal({ isOpen, onClose, onSuccess }: AddRelayModalProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [picked, setPicked] = useState<RelayPreset | null>(null);

    const [name, setName] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [protocol, setProtocol] = useState<'responses' | 'chat_completions'>('responses');
    const [usagePreset, setUsagePreset] = useState<string | null>(null);
    const [usageCookie, setUsageCookie] = useState('');
    const [modelFallback, setModelFallback] = useState('');
    const [modelMapText, setModelMapText] = useState('');
    const [advOpen, setAdvOpen] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset step when modal closes
    useEffect(() => {
        if (!isOpen) {
            setStep(1);
            setPicked(null);
            setName('');
            setApiKey('');
            setUsageCookie('');
            setAdvOpen(false);
            setError(null);
            setSubmitting(false);
        }
    }, [isOpen]);

    const handlePick = (p: RelayPreset) => {
        setPicked(p);
        setName(p.name);
        setBaseUrl(p.base_url);
        setProtocol(p.relay_protocol ?? 'responses');
        setUsagePreset(p.usage_preset ?? null);
        setUsageCookie('');
        setModelFallback(p.model_fallback ?? '');
        setModelMapText(p.model_map
            ? Object.entries(p.model_map).map(([k, v]) => `${k}=${v}`).join('\n')
            : '');
        setAdvOpen(false);
        setError(null);
        setStep(2);
    };

    const handleBack = () => {
        setStep(1);
        setError(null);
    };

    const handleSubmit = async () => {
        if (!picked) return;
        setError(null);
        if (!name.trim()) { setError('Account name cannot be empty'); return; }
        if (!/^https?:\/\//.test(baseUrl.trim())) {
            setError('Base URL must start with http:// or https://');
            return;
        }
        // Local Ollama etc.: any non-empty key is OK.
        // Real sk-/tp- keys are usually ≥30 chars; relaxed for local.
        if (apiKey.trim().length < 1) { setError('API Key cannot be empty'); return; }
        if (usagePreset === 'mimo_token_plan' && !usageCookie.trim()) {
            setError('MiMo quota lookup requires a Cookie from platform.xiaomimimo.com; to skip quota, set strategy to "Do not fetch".');
            return;
        }
        setSubmitting(true);
        try {
            const modelMap = parseModelMapText(modelMapText);
            await invoke('add_relay_account', {
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                apiKey: apiKey.trim(),
                homepage: picked.homepage ?? null,
                usagePreset: usagePreset ?? null,
                usageCookie: usageCookie.trim() || null,
                notes: `from preset:${picked.id}`,
                modelMap: Object.keys(modelMap).length > 0 ? modelMap : null,
                modelFallback: modelFallback.trim() || null,
                relayProtocol: protocol === 'responses' ? null : protocol,
                relayCategory: picked.category ?? 'aggregator',
            });
            await emit('accounts-updated');
            onSuccess?.();
            onClose();
        } catch (e) {
            setError(typeof e === 'string' ? e : String(e));
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="cs-relay-modal cs-relay-modal__overlay" onClick={onClose}>
            <div className="cs-relay-modal__panel" onClick={(e) => e.stopPropagation()}>
                <div className="cs-relay-modal__header">
                    <div className="cs-relay-modal__title">
                        <div className="cs-relay-modal__icon">⇄</div>
                        <h2>Add Relay</h2>
                        <span className="cs-relay-modal__sub">Pick preset · paste key</span>
                    </div>
                    <button className="cs-relay-modal__close" onClick={onClose}>×</button>
                </div>

                <div className="cs-relay-steps">
                    <div className={`cs-relay-step${step === 1 ? ' cs-relay-step--active' : ' cs-relay-step--done'}`}>
                        <span className="cs-relay-step__num">{step > 1 ? '✓' : '1'}</span>
                        Choose relay
                    </div>
                    <div className={`cs-relay-step${step === 2 ? ' cs-relay-step--active' : ''}`}>
                        <span className="cs-relay-step__num">2</span>
                        Enter credentials
                    </div>
                </div>

                <div className="cs-relay-modal__body">
                    {step === 1 ? (
                        <Step1Picker
                            pickedId={picked?.id ?? null}
                            onPick={handlePick}
                        />
                    ) : picked ? (
                        <>
                            <Step2Form
                                preset={picked}
                                name={name} setName={setName}
                                baseUrl={baseUrl} setBaseUrl={setBaseUrl}
                                apiKey={apiKey} setApiKey={setApiKey}
                                protocol={protocol} setProtocol={setProtocol}
                                usagePreset={usagePreset} setUsagePreset={setUsagePreset}
                                usageCookie={usageCookie} setUsageCookie={setUsageCookie}
                                modelFallback={modelFallback} setModelFallback={setModelFallback}
                                modelMapText={modelMapText} setModelMapText={setModelMapText}
                                advOpen={advOpen} setAdvOpen={setAdvOpen}
                                onChangeProvider={handleBack}
                            />
                            {error && <div className="cs-rerror">{error}</div>}
                        </>
                    ) : null}
                </div>

                <div className="cs-relay-modal__footer">
                    {step === 2 ? (
                        <button className="cs-rbtn cs-rbtn--ghost" onClick={handleBack} disabled={submitting}>
                            ← Back to picker
                        </button>
                    ) : (
                        <span style={{ fontSize: 11, color: 'var(--r-fg-muted)' }}>
                            Next step — base URL already filled
                        </span>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="cs-rbtn cs-rbtn--ghost" onClick={onClose} disabled={submitting}>
                            Cancel
                        </button>
                        {step === 2 && (
                            <button
                                className="cs-rbtn cs-rbtn--purple"
                                onClick={handleSubmit}
                                disabled={submitting}
                            >
                                {submitting ? 'Importing…' : 'Import relay'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
