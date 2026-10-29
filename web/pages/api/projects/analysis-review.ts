import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'node:crypto';
import { adminDb } from '../../../lib/firebaseAdmin';
import { loadProjectContext } from '../../../lib/project-context-server';
import { AccessError, memberActive, memberPath } from '../../../lib/membership/server';
import { canManageProject } from '../../../lib/rbac';
import type { ProjectMeta } from '../../../lib/projects';
import { emptyAnalysisReview, type AnalysisFinding, type AnalysisReview } from '../../../lib/spatial/analysis-review';
import { deriveBoundary, boundaryGeoJSON } from '../../../lib/spatial/boundary';
import { projectLayers } from '../../../lib/spatial/geo-server';
import { featureKey, resultFor, isArea, createBuffer, intersectionAreas, overlayArea, scorePriority } from '../../../lib/spatial/engine';
import { parseSpatialResult } from '../../../lib/spatial/context';
import { representativePoint } from '../../../lib/spatial/geo-query';
import { spatialResultSummary } from '../../../lib/spatial/goals';
import { localizeMessage } from '../../../lib/i18n';
export const config = { api: { bodyParser: { sizeLimit: '24kb' } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET', 'POST'].includes(req.method ?? '')) {
        res.setHeader('Allow', 'GET, POST');
        res.status(405).end();
        return;
    }
    if (req.method === 'GET')
        req.body = { projectId: req.query.projectId };
    try {
        const context = await loadProjectContext(req, 'data', false), { user, projectId } = context, db = adminDb(), ref = db.doc(`users_${projectId}/${user.uid}/steps/data`);
        if (req.method === 'GET') {
            res.status(200).json({ review: (await ref.get()).data()?.analysisReview ?? emptyAnalysisReview() });
            return;
        }
        const body = req.body;
        let finding: AnalysisFinding | undefined;
        if (body.action === 'add') {
            if (!['location', 'calculation', 'observation', 'issue', 'opportunity', 'interpretation'].includes(body.kind))
                throw new AccessError(400, 'review.invalid');
            finding = { id: randomUUID(), kind: body.kind, text: '', createdAt: new Date().toISOString() };
            if (body.kind === 'location' || body.kind === 'calculation') {
                const { layers } = await projectLayers(user, projectId);
                if (body.kind === 'location') {
                    const layer = layers.find(l => l.config.id === body.selection?.layerId), index = layer?.data.features.findIndex((f, i) => featureKey(f, i) === body.selection?.featureId) ?? -1;
                    if (!layer || index < 0)
                        throw new AccessError(400, 'gis.selectionChanged');
                    const feature = layer.data.features[index];
                    finding.text = String(feature.properties?.name ?? layer.config.label).slice(0, 200);
                    finding.location = { layerId: layer.config.id, featureId: featureKey(feature, index), coordinate: representativePoint(feature).coordinate };
                    finding.sources = [layer.config.id];
                }
                else {
                    const input = parseSpatialResult(body.result);
                    if (!input || input.projectId !== projectId)
                        throw new AccessError(400, 'review.invalid');
                    const selected = layers.filter(l => input.layerIds.includes(l.config.id));
                    if (selected.length !== input.layerIds.length)
                        throw new AccessError(409, 'gis.selectionChanged');
                    let actual;
                    if (input.type === 'area' || input.type === 'buffer') {
                        const layer = layers.find(l => l.config.id === input.parameters.selectedLayerId), feature = input.parameters.selectedFeatureId === '__boundary__' && layer ? deriveBoundary(boundaryGeoJSON(layer.data)).geometry : layer?.data.features.find((f, i) => featureKey(f, i) === input.parameters.selectedFeatureId);
                        if (!feature)
                            throw new AccessError(400, 'gis.selectionChanged');
                        const shape = input.type === 'buffer' ? createBuffer(feature, Number(input.parameters.distanceMeters)) : feature;
                        if (!isArea(shape))
                            throw new AccessError(400, 'review.invalid');
                        actual = resultFor(projectId, input.type, selected, shape, input.parameters);
                    }
                    else if (input.type === 'intersection') {
                        const a = selected.find(l => l.config.id === input.parameters.layerA), b = selected.find(l => l.config.id === input.parameters.layerB);
                        if (!a || !b)
                            throw new AccessError(400, 'review.invalid');
                        actual = { ...input, metrics: { intersectionAreaSqm: overlayArea(intersectionAreas(a, b)) }, timestamp: new Date().toISOString() };
                    }
                    else {
                        const criteria = JSON.parse(String(input.parameters.criteria));
                        if (selected.length !== 1 || !Array.isArray(criteria) || criteria.length > 10)
                            throw new AccessError(400, 'review.invalid');
                        const scores = scorePriority(selected[0], criteria);
                        actual = { ...input, metrics: { priorityCount: scores.length }, priorities: scores.slice(0, 20), timestamp: new Date().toISOString() };
                    }
                    finding.text = spatialResultSummary(actual).map(line => localizeMessage(req.body.locale === 'en' ? 'en' : 'ko', line)).join('\n');
                    finding.sources = actual.layerIds;
                }
            }
            else {
                if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1500)
                    throw new AccessError(400, 'review.invalid');
                finding.text = body.text.trim();
            }
        }
        else if (body.action !== 'summary' && body.action !== 'delete')
            throw new AccessError(400, 'review.invalid');
        let result: AnalysisReview = emptyAnalysisReview();
        await db.runTransaction(async (tx) => {
            const [saved, p, m, locks, summary] = await Promise.all([tx.get(ref), tx.get(db.doc(`ppssProjects/${projectId}`)), tx.get(db.doc(memberPath(user.uid, projectId))), tx.get(db.doc(`ppssStageLocks_${projectId}/current`)), tx.get(db.doc(`ppssWorkspaceSummaries_${projectId}/${user.uid}`))]);
            if (!p.exists || (!canManageProject(user.email, p.data() as ProjectMeta) && !memberActive(m.data())))
                throw new AccessError(403, 'review.forbidden');
            if (locks.data()?.lockedStages?.data || summary.data()?.completedStages?.includes('data'))
                throw new AccessError(409, 'review.locked');
            result = saved.data()?.analysisReview ?? emptyAnalysisReview();
            if (finding) {
                if (result.findings.length >= 40)
                    throw new AccessError(400, 'review.limit');
                result = { ...result, findings: [...result.findings, finding] };
            }
            if (body.action === 'delete') {
                if (typeof body.id !== 'string')
                    throw new AccessError(400, 'review.invalid');
                result = { ...result, findings: result.findings.filter(f => f.id !== body.id) };
            }
            if (body.action === 'summary') {
                const s = body.summary;
                if (!s || ['conditions', 'issues', 'opportunities'].some(k => typeof s[k] !== 'string' || s[k].length > 3000))
                    throw new AccessError(400, 'review.invalid');
                result = { ...result, summary: { conditions: s.conditions, issues: s.issues, opportunities: s.opportunities } };
            }
            result = { ...result, updatedAt: new Date().toISOString() };
            tx.set(ref, { analysisReview: result }, { merge: true });
        });
        res.status(200).json({ review: result });
    }
    catch (e) {
        res.status(e instanceof AccessError ? e.status : 400).json({ error: e instanceof Error && /^(review|gis|boundary)\./.test(e.message) ? e.message : e instanceof AccessError ? e.message : 'review.failed' });
    }
}
