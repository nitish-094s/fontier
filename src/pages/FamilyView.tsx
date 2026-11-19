import { useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { Slider } from '@astryxdesign/core/Slider';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Spinner } from '@astryxdesign/core/Spinner';
import { ArrowLeft, Columns2, ExternalLink } from 'lucide-react';
import { useApp } from '../lib/state';
import { api, plural } from '../lib/api';
import { catalogSource, defaultWeight, pickSubset, sampleFor, styleLabel, useFont, type FontSource } from '../lib/fontLoader';
import { PreviewBar } from '../components/PreviewBar';
import { InstallFamilyButton, useFamilyStatus } from '../components/FontCard';
import { LicenseBadge } from '../components/LicenseBadge';
import { CATEGORY_LABEL, SOURCE_LABEL, type CatalogFamily, type FaceInfo } from '../lib/types';

const WATERFALL = [96, 72, 56, 44, 36, 28, 22, 18, 15, 13, 11];

const CHARSETS: Record<string, string> = {
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&@#%?!.,:;\'"()[]{}/\\*+-=<>_~$€£₹¥',
  'latin-ext': 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝßàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿĀāĂăĄąĆćČčĎďĘęĚěĞğŁłŃńŇňŐőŒœŘřŚśŞşŠšŢţŤťŰűŸŹźŻżŽž',
  cyrillic: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  greek: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω',
  vietnamese: 'ẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ',
  devanagari: 'अआइईउऊऋएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह०१२३४५६७८९',
  bengali: 'অআইঈউঊঋএঐওঔকখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহ',
  gujarati: 'અઆઇઈઉઊઋએઐઓઔકખગઘઙચછજઝઞટઠડઢણતથદધનપફબભમયરલવશષસહ',
  gurmukhi: 'ਅਆਇਈਉਊਏਐਓਔਕਖਗਘਙਚਛਜਝਞਟਠਡਢਣਤਥਦਧਨਪਫਬਭਮਯਰਲਵਸ਼ਸਹ',
  kannada: 'ಅಆಇಈಉಊಋಎಏಐಒಓಔಕಖಗಘಙಚಛಜಝಞಟಠಡಢಣತಥದಧನಪಫಬಭಮಯರಲವಶಷಸಹ',
  malayalam: 'അആഇഈഉഊഋഎഏഐഒഓഔകഖഗഘങചഛജഝഞടഠഡഢണതഥദധനപഫബഭമയരലവശഷസഹ',
  tamil: 'அஆஇஈஉஊஎஏஐஒஓஔகஙசஞடணதநபமயரலவழளறன',
  telugu: 'అఆఇఈఉఊఋఎఏఐఒఓఔకఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరలవశషసహ',
  arabic: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي٠١٢٣٤٥٦٧٨٩',
  hebrew: 'אבגדהוזחטיכלמנסעפצקרשת',
  thai: 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ',
};

function StyleRow({ src, label, text, size, checked, onCheck, weight, italic }: { src: FontSource | null; label: string; text: string; size: number; checked?: boolean; onCheck?: (v: boolean) => void; weight?: number; italic?: boolean }) {
  const { family } = useFont(src);
  return (
    <div className="style-row">
      <div className="style-row-head">
        {onCheck && <CheckboxInput label={`Select ${label}`} isLabelHidden size="sm" value={!!checked} onChange={onCheck} />}
        <span className="muted small">{label}</span>
      </div>
      <div className="style-sample" style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined, fontSize: size, fontWeight: weight, fontStyle: italic ? 'italic' : undefined, opacity: family ? 1 : 0.3 }}>
        {text}
      </div>
    </div>
  );
}

function Pairing({ a, b }: { a: CatalogFamily; b: CatalogFamily }) {
  const { openFamily } = useApp();
  const fa = useFont(catalogSource(a, a.styles.includes('700') ? 700 : undefined)).family;
  const fb = useFont(catalogSource(b)).family;
  return (
    <button className="pairing" onClick={() => openFamily(b.id)}>
      <div className="pairing-head" style={{ fontFamily: fa ? `${fa}, var(--font-family-body)` : undefined }}>
        Built for the ride ahead
      </div>
      <div className="pairing-body" style={{ fontFamily: fb ? `${fb}, var(--font-family-body)` : undefined }}>
        Good type does its work quietly. It sets the tone, carries the message and lets the reader move through the page without noticing the letters at all.
      </div>
      <div className="muted small">
        {a.family} + <strong>{b.family}</strong>
      </div>
    </button>
  );
}

export function FamilyView({ id }: { id: string }) {
  const { catalogById, catalog, openFamily, previewText, compare, toggleCompare, appInstalls } = useApp();
  const f = catalogById.get(id);
  const [tab, setTab] = useState<'waterfall' | 'styles' | 'chars' | 'pairs'>('waterfall');
  const [size, setSize] = useState(44);
  const [style, setStyle] = useState<string>('');
  const [vw, setVw] = useState(400);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sqFiles, setSqFiles] = useState<{ file: string; faces: FaceInfo[] }[] | null>(null);
  const { installed } = useFamilyStatus(f ?? ({ family: '' } as CatalogFamily));

  useEffect(() => {
    document.querySelector('.page')?.scrollTo({ top: 0 });
    setSelected(new Set());
    setSqFiles(null);
    if (f) {
      setStyle(f.source === 'fontsquirrel' ? '' : String(defaultWeight(f)));
      const wght = f.axes.find((a) => a.tag === 'wght');
      setVw(wght ? Math.round(wght.default) : 400);
    }
    if (f?.source === 'fontsquirrel' && f.sqUrl) api.squirrelPreview(f.sqUrl).then(setSqFiles).catch(() => setSqFiles([]));
  }, [id, f]);

  const pairings = useMemo(() => {
    if (!f || !catalog) return [];
    const want = f.category === 'sans' ? ['serif'] : f.category === 'serif' ? ['sans'] : ['sans', 'serif'];
    return catalog.families
      .filter((x) => x.source === 'google' && want.includes(x.category) && x.id !== f.id && x.subsets.includes('latin') && x.styleCount >= 4)
      .sort((a, b) => a.popularity - b.popularity)
      .slice(0, 40)
      .filter((_, i) => i % 6 === (f.family.length % 6))
      .slice(0, 4);
  }, [f, catalog]);

  if (!f) {
    return (
      <div className="center-pad">
        <Spinner size="lg" />
      </div>
    );
  }

  const text = sampleFor(f, previewText);
  const wght = f.axes.find((a) => a.tag === 'wght');
  const italicSel = style.endsWith('i');
  const sqPick = sqFiles?.find((s) => s.file === style) ?? sqFiles?.find((s) => /regular|book|roman/i.test(s.faces[0]?.style ?? '')) ?? sqFiles?.[0];
  const mainSource: FontSource | null =
    f.source === 'fontsquirrel'
      ? sqPick
        ? { kind: 'file', path: sqPick.file }
        : null
      : style === 'var' && f.fsId
        ? { kind: 'cdnvar', fsId: f.fsId, subset: pickSubset(f) }
        : catalogSource(f, parseInt(style, 10) || defaultWeight(f), italicSel);
  const styleOptions =
    f.source === 'fontsquirrel'
      ? (sqFiles ?? []).map((s) => ({ value: s.file, label: s.faces[0]?.style ?? 'Regular' }))
      : [...(wght && f.fsId ? [{ value: 'var', label: 'Variable (slider)' }] : []), ...f.styles.map((s) => ({ value: s, label: styleLabel(s) }))];
  const charset = [...new Set(['latin', ...f.subsets])].filter((s) => CHARSETS[s]).map((s) => [s, CHARSETS[s]] as const);
  const website =
    f.source === 'google'
      ? `https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, '+')}`
      : f.source === 'fontsquirrel'
        ? `https://www.fontsquirrel.com/fonts/${f.sqUrl}`
        : `https://fontsource.org/fonts/${f.fsId}`;
  const canPick = f.source !== 'fontsquirrel';
  const update = appInstalls[f.id] && f.lastModified && appInstalls[f.id].lastModified < f.lastModified;

  return (
    <div className="family">
      <div className="family-top">
        <IconButton label="Back" tooltip="Back to Discover" variant="ghost" icon={<ArrowLeft size={18} />} onClick={() => openFamily(null)} />
        <div className="crumbs muted small">
          Discover / {CATEGORY_LABEL[f.category]}
        </div>
      </div>
      <FamilyHero f={f} source={mainSource} vw={style === 'var' ? vw : undefined} />
      <div className="family-meta">
        <div className="family-facts">
          <span>{f.designer || SOURCE_LABEL[f.source]}</span>
          <span className="dot" />
          <span>{plural(f.styleCount, 'style')}</span>
          {f.variable && (
            <>
              <span className="dot" />
              <span>Variable{f.axes.length ? ` (${f.axes.map((a) => a.tag).join(', ')})` : ''}</span>
            </>
          )}
          <span className="dot" />
          <span>{SOURCE_LABEL[f.source]}</span>
          {f.dateAdded && (
            <>
              <span className="dot" />
              <span>Added {new Date(f.dateAdded).getFullYear()}</span>
            </>
          )}
          <LicenseBadge license={f.license} />
          {update && <span className="chip warn">Update available</span>}
        </div>
        <div className="family-actions">
          <Button variant="ghost" label="Website" icon={<ExternalLink size={15} />} onClick={() => openUrl(website)} />
          <Button variant={compare.includes(f.id) ? 'secondary' : 'ghost'} label={compare.includes(f.id) ? 'In compare' : 'Compare'} icon={<Columns2 size={15} />} onClick={() => toggleCompare(f.id)} />
          {selected.size > 0 && <InstallFamilyButton f={f} size="md" styles={[...selected]} label={`Install ${plural(selected.size, 'style')}`} />}
          {update ? <InstallFamilyButton f={f} size="md" styles={null} label="Update family" /> : <InstallFamilyButton f={f} size="md" />}
        </div>
      </div>
      {f.subsets.length > 0 && (
        <div className="langs">
          {f.subsets.slice(0, 18).map((s) => (
            <span key={s} className="tag subtle">
              {s}
            </span>
          ))}
          {f.subsets.length > 18 && <span className="tag subtle">+{f.subsets.length - 18}</span>}
        </div>
      )}

      <div className="family-tabs">
        <SegmentedControl label="View" value={tab} onChange={(v) => setTab(v as typeof tab)}>
          <SegmentedControlItem value="waterfall" label="Waterfall" />
          <SegmentedControlItem value="styles" label={`Styles (${f.source === 'fontsquirrel' ? sqFiles?.length ?? '…' : f.styles.length})`} />
          <SegmentedControlItem value="chars" label="Characters" />
          <SegmentedControlItem value="pairs" label="Pairings" />
        </SegmentedControl>
        {tab === 'waterfall' && styleOptions.length > 0 && (
          <Selector label="Style" isLabelHidden size="sm" value={style || styleOptions[0]?.value} onChange={(v) => v && setStyle(v)} options={styleOptions} width={200} />
        )}
        {tab === 'waterfall' && style === 'var' && wght && (
          <Slider label="Weight" isLabelHidden min={wght.min} max={wght.max} value={vw} onChange={(v: number) => setVw(v)} width={220} formatValue={(v) => `wght ${v}`} />
        )}
      </div>

      {installed && !selected.size && <div className="muted small installed-note">This family is installed on your PC.</div>}

      {tab === 'waterfall' && (
        <div className="panel waterfall">
          {WATERFALL.map((px) => (
            <WaterRow key={px} px={px} text={text} source={mainSource} vw={style === 'var' ? vw : undefined} />
          ))}
        </div>
      )}

      {tab === 'styles' && (
        <div className="panel">
          <PreviewBar size={size} onSize={setSize} />
          {canPick && (
            <div className="pick-row">
              <span className="muted small">Tick styles to install only those, or install the whole family.</span>
              {selected.size > 0 && <Button size="sm" variant="ghost" label="Clear selection" onClick={() => setSelected(new Set())} />}
            </div>
          )}
          {f.source === 'fontsquirrel' && !sqFiles && (
            <div className="center-pad">
              <Spinner label="Fetching styles" />
            </div>
          )}
          {f.source === 'fontsquirrel'
            ? sqFiles?.map((s) => <StyleRow key={s.file} src={{ kind: 'file', path: s.file }} label={s.faces[0]?.style ?? ''} text={text} size={size} />)
            : f.styles.map((s) => (
                <StyleRow
                  key={s}
                  src={catalogSource(f, parseInt(s, 10), s.endsWith('i'))}
                  label={styleLabel(s)}
                  text={text}
                  size={size}
                  checked={selected.has(s)}
                  onCheck={(v) =>
                    setSelected((prev) => {
                      const n = new Set(prev);
                      if (v) n.add(s);
                      else n.delete(s);
                      return n;
                    })
                  }
                />
              ))}
        </div>
      )}

      {tab === 'chars' && <CharGrid source={mainSource} sets={charset} vw={style === 'var' ? vw : undefined} />}

      {tab === 'pairs' && (
        <div className="pairings">
          {pairings.map((p) => (
            <Pairing key={p.id} a={f} b={p} />
          ))}
          {pairings.length === 0 && <div className="muted">No pairing suggestions for this family.</div>}
        </div>
      )}
    </div>
  );
}

function FamilyHero({ f, source, vw }: { f: CatalogFamily; source: FontSource | null; vw?: number }) {
  const { family } = useFont(source);
  return (
    <h1 className="family-name" style={{ fontFamily: family ? `${family}, var(--font-family-heading)` : undefined, fontVariationSettings: vw ? `"wght" ${vw}` : undefined }}>
      {f.family}
    </h1>
  );
}

function WaterRow({ px, text, source, vw }: { px: number; text: string; source: FontSource | null; vw?: number }) {
  const { family } = useFont(source);
  return (
    <div className="water-row">
      <span className="water-size">{px}</span>
      <div className="water-text" style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined, fontSize: px, fontVariationSettings: vw ? `"wght" ${vw}` : undefined, opacity: family ? 1 : 0.3 }}>
        {text}
      </div>
    </div>
  );
}

function CharGrid({ source, sets, vw }: { source: FontSource | null; sets: (readonly [string, string])[]; vw?: number }) {
  const { family } = useFont(source);
  const [hover, setHover] = useState('A');
  return (
    <div className="chars">
      <div className="panel char-big" style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined, fontVariationSettings: vw ? `"wght" ${vw}` : undefined }}>
        <span>{hover}</span>
        <div className="muted small">U+{hover.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}</div>
      </div>
      <div className="char-sets">
        {sets.map(([name, chars]) => (
          <div key={name}>
            <div className="muted small char-set-name">{name}</div>
            <div className="char-grid" style={{ fontFamily: family ? `${family}, var(--font-family-body)` : undefined, fontVariationSettings: vw ? `"wght" ${vw}` : undefined }}>
              {[...chars].map((c, i) => (
                <span key={i} onMouseEnter={() => setHover(c)}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
