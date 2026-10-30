import {gisReflection,policyHistory} from "../../../lib/facilitation";
import {conversationHistory} from "../../../lib/chat-history";
import type { NextApiRequest, NextApiResponse } from 'next';
import { loadProjectContext } from '../../../lib/project-context-server';
import { AccessError } from '../../../lib/membership/server';
import { projectLayers, executeGeoQuery } from '../../../lib/spatial/geo-server';
import { KakaoError } from '../../../lib/spatial/kakao-server';
import { parseGeoContext, parseGeoPlan } from '../../../lib/spatial/geo-query';
import { translate, localizeMessage } from '../../../lib/i18n';
export const config = { api: { bodyParser: { sizeLimit: '40kb' } } };
export const maxDuration = 60;
const requests = new Map<string, {
    time: number;
    count: number;
}>();
export function allowGeoRequest(key: string, now = Date.now()) {
    for (const [id, v] of requests)
        if (now - v.time > 60000)
            requests.delete(id);
    if (requests.size >= 2000 && !requests.has(key))
        return false;
    const previous = requests.get(key);
    if (previous) {
        previous.count++;
        return previous.count <= 12;
    }
    requests.set(key, { time: now, count: 1 });
    return true;
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'private, no-store');
    const locale = req.body?.locale === 'en' ? 'en' : 'ko';
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ error: translate(locale, 'gis.invalidQuestion') });
        return;
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const close = () => { if (!res.writableEnded)
        abort.abort(); };
    req.once?.('aborted', cancel);
    res.once?.('close', close);
    try {
        const context = await loadProjectContext(req, 'data', true, true);
        parseGeoPlan(req.body.question);
        parseGeoContext(req.body.context);
        const choices = req.body.choices;
        if (choices !== undefined && (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.entries(choices).length > 3 || Object.entries(choices).some(([k, v]) => k.length > 200 || typeof v !== 'string' || v.length > 5000)))
            throw new Error('gis.invalidQuestion');
        if (!allowGeoRequest(`${context.user.uid}:${context.projectId}`)) {
            res.status(429).json({ error: translate(locale, 'gis.quota') });
            return;
        }
        const { layers, warnings, boundary, settings } = await projectLayers(context.user, context.projectId, abort.signal);
        abort.signal.throwIfAborted();
        const result = await executeGeoQuery(req.body, context.user, context.projectId, layers, warnings, abort.signal,{boundary,settings});
        abort.signal.throwIfAborted();
        const reflection=gisReflection(req.body.question,policyHistory(context.stageHistory,conversationHistory(req.body.history)),!!(result.route||result.computedResult)&&!result.clarify,locale);
        if(reflection){result.facilitationQuestion=reflection;result.reply+='\n\n'+reflection;}
        res.status(200).json({ result });
    }
    catch (error) {
        const key = error instanceof Error && /^(gis|boundary)\./.test(error.message) ? error.message : 'gis.failed';
        if (abort.signal.aborted)
            return;
        res.status(error instanceof AccessError ? error.status : error instanceof KakaoError ? error.status : key === 'gis.failed' ? 503 : 400).json({ error: error instanceof AccessError ? localizeMessage(locale,error.message,'access.checkFailed') : translate(locale, key) });
    }
    finally {
        req.removeListener?.('aborted', cancel);
        res.removeListener?.('close', close);
    }
}
