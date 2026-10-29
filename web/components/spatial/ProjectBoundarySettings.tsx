import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { projectRequest } from '../../lib/membership/client';
import { datasetLayer, type SpatialDataset } from '../../lib/spatial/datasets';
import { loadLayer } from '../../lib/spatial/loader';
import { boundaryGeoJSON, deriveBoundary, type SpatialSettings } from '../../lib/spatial/boundary';
import type { LoadedLayer } from '../../lib/spatial/types';
import SpatialMap from './SpatialMap';
export default function ProjectBoundarySettings({ projectId, datasets, settings, onSaved }: {
    projectId: string;
    datasets: SpatialDataset[];
    settings: SpatialSettings;
    onSaved: () => Promise<void>;
}) {
    const { t, localize } = useI18n(), { user } = useAuth();
    const [id, setId] = useState(settings.activeBoundaryDatasetId ?? ''), [meters, setMeters] = useState<number>(settings.defaultNearbyMeters), [crs, setCrs] = useState(''), [preview, setPreview] = useState<LoadedLayer | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => { setId(settings.activeBoundaryDatasetId ?? ''); setMeters(settings.defaultNearbyMeters); setPreview(null); }, [projectId, settings.activeBoundaryDatasetId, settings.defaultNearbyMeters]);
    const dataset = datasets.find(d => d.datasetId === id);
    let derived;
    try {
        if (preview)
            derived = deriveBoundary(boundaryGeoJSON(preview.data));
    }
    catch { }
    const display = async () => { if (!user || !dataset)
        return; setBusy(true); setError(''); try {
        const config = datasetLayer(dataset);
        if (!config)
            throw new Error('boundary.invalid');
        const loaded = await loadLayer(config, await user.getIdToken());
        setPreview(loaded);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'boundary.invalid');
    }
    finally {
        setBusy(false);
    } };
    const save = async () => { if (!user || busy)
        return; if (settings.activeBoundaryDatasetId !== (id || null) && settings.activeBoundaryDatasetId && !window.confirm(t('boundary.confirmChange')))
        return; setBusy(true); setError(''); try {
        await projectRequest(user, '/api/projects/spatial-datasets', { action: 'boundary-settings', projectId, activeBoundaryDatasetId: id || null, defaultNearbyMeters: meters, expectedBoundaryId: settings.activeBoundaryDatasetId, ...(dataset ? { expectedBoundaryRevisionId: dataset.revisionId } : {}), confirmBoundaryChange: true, ...(dataset && !dataset.sourceCrs ? { sourceCrs: crs } : {}) });
        await onSaved();
        setError('boundary.saved');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'dataset.saveFailed');
    }
    finally {
        setBusy(false);
    } };
    return <section className="mt-5 space-y-3 rounded-xl border border-blue-100 p-4" aria-label={t('boundary.settings')}>
  <h4 className="font-semibold">{t('boundary.settings')}</h4><p className="text-xs text-slate-600">{t('boundary.uploadHint')}</p>
  <p className="text-sm">{t('boundary.active')}: {datasets.find(d => d.datasetId === settings.activeBoundaryDatasetId)?.name ?? t('boundary.none')}</p>
  <label className="grid gap-1 text-sm">{t('boundary.choose')}<select aria-label={t("boundary.choose")} className="min-h-11 w-full rounded border p-2" value={id} onChange={e => { setId(e.target.value); setPreview(null); setCrs(''); }} disabled={busy}><option value="">{t('boundary.none')}</option>{datasets.filter(d => d.type === 'project_boundary').map(d => <option key={d.datasetId} value={d.datasetId}>{d.name}</option>)}</select></label>
  {dataset && !dataset.sourceCrs && <label className="grid gap-1 text-sm">{t('boundary.confirmCrs')}<select aria-label={t("boundary.confirmCrs")} value={crs} onChange={e => setCrs(e.target.value)} className="min-h-11 rounded border p-2"><option value="">{t('boundary.selectCrs')}</option><option value="EPSG:4326">WGS84 · EPSG:4326</option></select></label>}
  <label className="grid gap-1 text-sm">{t('boundary.defaultDistance')}<select aria-label={t("boundary.defaultDistance")} className="min-h-11 rounded border p-2" value={meters} onChange={e => setMeters(Number(e.target.value))}>{[0, 500, 1000].map(n => <option key={n} value={n}>{t(`boundary.scope.${n}`)}</option>)}</select></label>
  <div className="flex flex-wrap gap-2"><button className="spatial-button" type="button" onClick={() => void display()} disabled={busy || !dataset}>{t('boundary.preview')}</button><button className="spatial-button" type="button" onClick={() => void save()} disabled={busy || !!dataset && !dataset.sourceCrs && !crs}>{t('workspace.save')}</button></div>
  {preview && <SpatialMap layers={[preview]} visible={[preview.config.id]} overlay={{ type: 'FeatureCollection', features: [] }} extent={derived?.bbox} onSelect={() => { }}/>}
  {derived && <p className="text-xs">{t('boundary.area', { area: Math.round(derived.areaSqm).toLocaleString() })}</p>}
  {error && <p role="status" className="text-sm text-slate-700">{localize(error, 'dataset.saveFailed')}</p>}
 </section>;
}
