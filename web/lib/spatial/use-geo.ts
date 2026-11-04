import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import type { GeoContext, GeoResult, Place } from './geo-query';
export function useGeoWorkspace(projectId: string) {
    const { user } = useAuth();
    const { locale } = useI18n();
    const [context, setContext] = useState<GeoContext>({});
    const [result, setResult] = useState<GeoResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const [chosenPlace, setChosenPlace] = useState<Place | null>(null);
    const [candidates, setCandidates] = useState<Place[]>([]);
    const candidateReference = useRef<string | null>(null);
    const abort = useRef<AbortController | null>(null);
    const current = useRef<{question:string;choices:Record<string,string>;history:import('../chat-history').ConversationMessage[];queryContext?:GeoContext}>({question:'',choices:{},history:[]});
    useEffect(() => { abort.current?.abort(); setContext({}); setResult(null); setLoading(false); setError(''); setHighlighted(null); setChosenPlace(null);setCandidates([]);candidateReference.current=null;current.current = { question: '', choices: {},history:[] }; return () => abort.current?.abort(); }, [projectId, user?.uid]);
    const clear = useCallback(() => { abort.current?.abort(); setResult(null); setLoading(false); setError(''); setHighlighted(null);setChosenPlace(null);setCandidates([]);candidateReference.current=null; current.current = { question: '', choices: {},history:[] }; }, []);
    const run = useCallback(async (question: string, choice?: {
        reference: string;
        token: string;
    }, history?: import('../chat-history').ConversationMessage[]) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setLoading(true);
        setError('');
        if (!choice) { setResult(null);setHighlighted(null);setChosenPlace(null);setCandidates([]);candidateReference.current=null; }
        const choices = current.current.question === question ? { ...current.current.choices } : {};
        const queryContext = choice && current.current.question === question ? current.current.queryContext ?? context : context;
        if (choice)
            choices[choice.reference] = choice.token;
        current.current = { question, choices,history:history??(current.current.question===question?current.current.history:[]),queryContext };
        try {
            if (!user)
                throw new Error('common.authRequired');
            const token = await user.getIdToken();
            if (controller.signal.aborted)
                return;
            const response = await fetch('/api/spatial/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: controller.signal, body: JSON.stringify({ projectId, question, context:queryContext, choices, locale,history:current.current.history }) });
            const payload = await response.json();
            if (controller.signal.aborted)
                return;
            if (!response.ok)
                throw new Error(payload.error ?? 'gis.failed');
            setResult(payload.result);
            if (payload.result.clarify) {
                setCandidates(payload.result.clarify.options);
                if (candidateReference.current !== payload.result.clarify.reference) { setChosenPlace(null);setHighlighted(null); }
                candidateReference.current=payload.result.clarify.reference;
            } else if (!choice) setCandidates(payload.result.places);
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
    const choosePlace = (place: Place) => {
        setChosenPlace(place);setHighlighted(place.id);
        setContext(previous=>({scopeMeters:previous.scopeMeters,mapCenter:previous.mapCenter,...(place.source==='project'&&place.layerId&&place.featureId?{selected:{layerId:place.layerId,featureId:place.featureId}}:{point:place.coordinate})}));
        if (candidateReference.current && place.choiceToken && result) void run(result.question, {reference:candidateReference.current,token:place.choiceToken});
    };
    return { context, setContext, result, loading, error, highlighted, setHighlighted, chosenPlace, candidates, choosePlace, run, clear };
}
export type GeoWorkspace = ReturnType<typeof useGeoWorkspace>;
