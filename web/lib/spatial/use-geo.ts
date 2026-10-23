import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import type { GeoContext, GeoResult } from './geo-query';
export function useGeoWorkspace(projectId: string) {
    const { user } = useAuth();
    const { locale } = useI18n();
    const [context, setContext] = useState<GeoContext>({});
    const [result, setResult] = useState<GeoResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const abort = useRef<AbortController | null>(null);
    const current = useRef({ question: '', choices: {} as Record<string, string> });
    useEffect(() => { abort.current?.abort(); setContext({}); setResult(null); setLoading(false); setError(''); setHighlighted(null); current.current = { question: '', choices: {} }; return () => abort.current?.abort(); }, [projectId, user?.uid]);
    const clear = useCallback(() => { abort.current?.abort(); setResult(null); setLoading(false); setError(''); setHighlighted(null); current.current = { question: '', choices: {} }; }, []);
    const run = useCallback(async (question: string, choice?: {
        reference: string;
        token: string;
    }) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setLoading(true);
        setError('');
        setResult(null);
        setHighlighted(null);
        const choices = current.current.question === question ? { ...current.current.choices } : {};
        if (choice)
            choices[choice.reference] = choice.token;
        current.current = { question, choices };
        try {
            if (!user)
                throw new Error('common.authRequired');
            const token = await user.getIdToken();
            if (controller.signal.aborted)
                return;
            const response = await fetch('/api/spatial/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: controller.signal, body: JSON.stringify({ projectId, question, context, choices, locale }) });
            const payload = await response.json();
            if (controller.signal.aborted)
                return;
            if (!response.ok)
                throw new Error(payload.error ?? 'gis.failed');
            setResult(payload.result);
            return payload.result as GeoResult;
        }
        catch (error) {
            if (!controller.signal.aborted)
                setError(error instanceof Error ? error.message : 'gis.failed');
        }
        finally {
            if (!controller.signal.aborted)
                setLoading(false);
        }
    }, [context, locale, projectId, user]);
    return { context, setContext, result, loading, error, highlighted, setHighlighted, run, clear };
}
export type GeoWorkspace = ReturnType<typeof useGeoWorkspace>;
