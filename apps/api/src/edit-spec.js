import { DownloadError } from './errors.js';

function invalid(message) {
  return new DownloadError('INVALID_EDIT', message, 400);
}

function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw invalid(`${name} ${min} ile ${max} arasında olmalıdır.`);
  }
  return value;
}

const even = (value) => Math.max(2, Math.floor(value / 2) * 2);

function positive(value, name) {
  number(value, name, 0, Number.MAX_VALUE);
  if (value === 0) throw invalid(`${name} sıfırdan büyük olmalıdır.`);
  return value;
}

function boolean(value, name, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw invalid(`${name} açık veya kapalı olmalıdır.`);
  return value;
}

function normalizeClips(value, media) {
  if (!Array.isArray(value) || !value.length) throw invalid('Zaman çizelgesinde en az bir klip olmalıdır.');
  return value.map((clip) => {
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) throw invalid('Klip bilgileri geçersiz.');
    if (clip.id !== undefined && typeof clip.id !== 'string') throw invalid('Klip kimliği metin olmalıdır.');
    if (clip.gapDuration !== undefined) {
      if (clip.start !== undefined || clip.end !== undefined || clip.freezeDuration !== undefined) {
        throw invalid('Boşluk ile video klibi aynı anda tanımlanamaz.');
      }
      return { id: clip.id, gapDuration: positive(clip.gapDuration, 'Boşluk süresi'), duration: clip.gapDuration };
    }
    const start = number(clip.start, 'Klip başlangıcı', 0, media.duration);
    if (start >= media.duration) throw invalid('Klip başlangıcı kaynak videonun bitişinden önce olmalıdır.');
    const speed = number(clip.speed ?? 1, 'Klip hızı', 0.25, 4);
    const volume = number(clip.volume ?? 1, 'Ses seviyesi', 0, 2);
    const reverse = boolean(clip.reverse, 'Ters oynatma');
    const muted = boolean(clip.muted, 'Sesi kapat');
    const freezeDuration = clip.freezeDuration === undefined
      ? undefined : positive(clip.freezeDuration, 'Dondurulmuş kare süresi');
    const end = clip.end === undefined && freezeDuration
      ? start : Math.min(number(clip.end, 'Klip bitişi', 0, media.duration + 1 / media.fps), media.duration);
    if (end < start || (!freezeDuration && end === start)) throw invalid('Klip bitişi başlangıcından sonra olmalıdır.');
    const duration = freezeDuration ?? positive((end - start) / speed, 'Klip süresi');
    return { id: clip.id, start, end, speed, volume, reverse, muted, freezeDuration, duration };
  });
}

export function normalizeEdit(body, media, availableVoiceovers = new Map()) {
  if (!body || typeof body !== 'object') throw invalid('Düzenleme bilgileri eksik.');
  const clips = body.clips === undefined ? null : normalizeClips(body.clips, media);
  const start = clips ? 0 : number(body.trim?.start, 'Başlangıç', 0, media.duration);
  const end = clips ? 0 : number(body.trim?.end, 'Bitiş', 0, media.duration + 1 / media.fps);
  const duration = clips
    ? positive(clips.reduce((total, clip) => total + clip.duration, 0), 'Zaman çizelgesi süresi')
    : Math.min(end, media.duration) - start;
  if (!clips && duration < 0.1) throw invalid('Video en az 0,1 saniye olmalıdır.');
  if (body.voiceovers !== undefined && !Array.isArray(body.voiceovers)) throw invalid('Seslendirme listesi geçersiz.');
  const voiceovers = (body.voiceovers ?? []).map((voice) => {
    if (!voice || typeof voice !== 'object' || typeof voice.id !== 'string') throw invalid('Seslendirme bilgileri geçersiz.');
    const source = availableVoiceovers.get(voice.id);
    if (!source) throw invalid('Seslendirme bu videoya ait değil veya artık kullanılamıyor.');
    const voiceStart = number(voice.start ?? 0, 'Seslendirme başlangıcı', 0, duration);
    const offset = number(voice.offset ?? 0, 'Ses kaydı başlangıcı', 0, source.duration);
    const voiceDuration = Math.min(
      voice.duration === undefined ? source.duration - offset : positive(voice.duration, 'Seslendirme süresi'),
      duration - voiceStart, source.duration - offset,
    );
    positive(voiceDuration, 'Seslendirme süresi');
    return {
      id: voice.id, start: voiceStart, offset, duration: voiceDuration,
      volume: number(voice.volume ?? 1, 'Seslendirme ses seviyesi', 0, 2),
      muted: boolean(voice.muted, 'Seslendirmeyi sustur'),
    };
  });
  const crop = body.crop;
  const x = number(crop?.x, 'Kadraj X', 0, 1);
  const y = number(crop?.y, 'Kadraj Y', 0, 1);
  const width = number(crop?.width, 'Kadraj genişliği', 2 / media.width, 1);
  const height = number(crop?.height, 'Kadraj yüksekliği', 2 / media.height, 1);
  if (x + width > 1.000001 || y + height > 1.000001) throw invalid('Kadraj videonun dışına taşamaz.');
  const cropPixels = {
    width: even(width * media.width),
    height: even(height * media.height),
    x: Math.floor(x * media.width / 2) * 2,
    y: Math.floor(y * media.height / 2) * 2,
  };
  cropPixels.x = Math.min(cropPixels.x, even(media.width) - cropPixels.width);
  cropPixels.y = Math.min(cropPixels.y, even(media.height) - cropPixels.height);

  const output = body.output;
  if (!output || !['mp4', 'mov'].includes(output.format)) throw invalid('Dışa aktarma biçimi MP4 veya MOV olmalıdır.');
  if (!['source', '720', '1080', '2160'].includes(output.resolution)) {
    throw invalid('Geçersiz dışa aktarma çözünürlüğü.');
  }
  if (!['source', 24, 25, 29.97, 30, 50, 59.94, 60].includes(output.fps)) throw invalid('Geçersiz kare hızı.');
  const codec = output.codec ?? 'h264';
  if (!['h264', 'hevc'].includes(codec)) throw invalid('Geçersiz video kodlayıcısı.');
  if (!['recommended', 'high', 'low'].includes(output.quality)) throw invalid('Geçersiz kalite.');
  if (typeof output.name !== 'string' || output.name.length > 100) throw invalid('Dosya adı en fazla 100 karakter olabilir.');
  const filename = (output.name.replace(/\.(mp4|mov)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/^[. ]+|[. ]+$/g, '')
    || 'instagram-edit') + `.${output.format}`;
  const shortEdge = Number(output.resolution);
  // Scale the intended crop aspect; rounding the source rectangle first
  // would turn a 9:16 crop into a narrower, nonstandard phone export.
  const intendedWidth = width * media.width;
  const intendedHeight = height * media.height;
  const landscape = intendedWidth >= intendedHeight;
  const boxWidth = landscape ? shortEdge * 16 / 9 : shortEdge;
  const boxHeight = landscape ? shortEdge : shortEdge * 16 / 9;
  const scale = Math.min(boxWidth / intendedWidth, boxHeight / intendedHeight);
  const scaledEven = (value) => even(value + Number.EPSILON * Math.max(1, value) * 8);
  const outputWidth = output.resolution === 'source' ? cropPixels.width : scaledEven(intendedWidth * scale);
  const outputHeight = output.resolution === 'source' ? cropPixels.height : scaledEven(intendedHeight * scale);
  let text = null;
  if (body.text !== null && body.text !== undefined) {
    const overlay = body.text;
    if (typeof overlay.value !== 'string' || !overlay.value.trim() || overlay.value.length > 500 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(overlay.value)) {
      throw invalid('Yazı 1–500 karakter arasında olmalıdır.');
    }
    if (typeof overlay.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(overlay.color)) {
      throw invalid('Yazı rengi #RRGGBB biçiminde olmalıdır.');
    }
    text = {
      value: overlay.value,
      x: number(overlay.x, 'Yazı X', 0, 1),
      y: number(overlay.y, 'Yazı Y', 0, 1),
      size: number(overlay.size, 'Yazı boyutu', 2, 20),
      color: overlay.color,
      start: number(overlay.start, 'Yazı başlangıcı', 0, duration),
      end: number(overlay.end, 'Yazı bitişi', 0, duration + 1 / media.fps),
    };
    text.end = Math.min(text.end, duration);
    if (text.end - text.start < 0.05) throw invalid('Yazı en az 0,05 saniye görünmelidir.');
  }
  return {
    start, duration, clips, voiceovers, sourceFrameDuration: 1 / media.fps, hasAudio: Boolean(media.hasAudio),
    crop: cropPixels, text, filename, format: output.format, codec,
    width: outputWidth, height: outputHeight,
    fps: output.fps === 'source' ? media.fps : output.fps,
    crf: (codec === 'hevc' ? { recommended: 24, high: 20, low: 28 } :
      { recommended: 20, high: 18, low: 26 })[output.quality],
  };
}

function textFilter(spec) {
  const { text } = spec;
  return [
      'drawtext=fontfile=font.ttf', 'textfile=text.txt', 'expansion=none',
      `fontsize=${spec.height * text.size / 100}`,
      `fontcolor=0x${text.color.slice(1)}`,
      `x='max(0,min(w-text_w,w*${text.x}-text_w/2))'`,
      `y='max(0,min(h-text_h,h*${text.y}-text_h/2))'`,
      `borderw=${Math.max(1, Math.round(spec.height * 0.002))}`,
      'bordercolor=black@0.8', 'shadowcolor=black@0.65', 'shadowx=2', 'shadowy=2',
      `enable='between(t,${text.start},${text.end})'`,
    ].join(':');
}

function geometryFilters(spec) {
  return [
    `crop=${spec.crop.width}:${spec.crop.height}:${spec.crop.x}:${spec.crop.y}`,
    `scale=${spec.width}:${spec.height}`,
    'setsar=1',
  ];
}

function tempoFilters(speed) {
  const factors = [];
  // Chaining keeps every atempo factor in its high-quality 0.5..2 range.
  while (speed > 2) { factors.push('atempo=2'); speed /= 2; }
  while (speed < 0.5) { factors.push('atempo=0.5'); speed /= 0.5; }
  factors.push(`atempo=${speed}`);
  return factors;
}

export function exportFilterGraph(spec) {
  if (!spec.clips && !spec.voiceovers?.length) return null;
  const clips = spec.clips ?? [{
    start: spec.start, end: spec.start + spec.duration, duration: spec.duration,
    speed: 1, reverse: false, volume: 1, muted: false,
  }];
  const graph = [];
  const videoClips = clips.filter((clip) => clip.gapDuration === undefined);
  const audioClips = videoClips.filter((clip) => !clip.freezeDuration);
  const videoInputs = new Map(videoClips.map((clip, index) => [clip, videoClips.length === 1 ? '0:v:0' : `srcv${index}`]));
  const audioInputs = new Map(audioClips.map((clip, index) => [clip, audioClips.length === 1 ? '0:a:0' : `srca${index}`]));
  if (videoClips.length > 1) graph.push(`[0:v:0]split=${videoClips.length}${[...videoInputs.values()].map((name) => `[${name}]`).join('')}`);
  if (spec.hasAudio && audioClips.length > 1) graph.push(`[0:a:0]asplit=${audioClips.length}${[...audioInputs.values()].map((name) => `[${name}]`).join('')}`);
  clips.forEach((clip, index) => {
    if (clip.gapDuration) {
      graph.push(`color=c=black:s=${spec.width}x${spec.height}:r=${spec.fps}:d=${clip.duration},setsar=1,settb=AVTB[v${index}]`);
    } else {
      const filters = clip.freezeDuration
        // Extend the final frame so a freeze within the last source frame's
        // display interval still has a sample at/after its requested time.
        ? [`tpad=stop_mode=clone:stop_duration=${spec.sourceFrameDuration}`, `trim=start=${clip.start}`,
          'trim=end_frame=1', 'setpts=PTS-STARTPTS', ...geometryFilters(spec)]
        : [`trim=start=${clip.start}:end=${clip.end}`, 'setpts=PTS-STARTPTS', ...geometryFilters(spec),
          ...(clip.reverse ? ['reverse'] : []), `setpts=(PTS-STARTPTS)/${clip.speed}`];
      // Give every segment its full requested duration, including slow-motion
      // tails and freezes, before concatenation. All segment timestamps start at 0.
      filters.push(`tpad=stop_mode=clone:stop_duration=${clip.duration + 1 / spec.fps}`, `fps=${spec.fps}`,
        `trim=duration=${clip.duration}`, 'setpts=PTS-STARTPTS', 'settb=AVTB');
      graph.push(`[${videoInputs.get(clip)}]${filters.join(',')}[v${index}]`);
    }
    if (spec.hasAudio) {
      const audio = clip.gapDuration || clip.freezeDuration
        ? 'anullsrc=r=48000:cl=stereo'
        : `[${audioInputs.get(clip)}]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS,` +
          [...(clip.reverse ? ['areverse'] : []), ...tempoFilters(clip.speed),
            `volume=${clip.muted ? 0 : clip.volume}`,
            'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
            `apad=whole_dur=${clip.duration}`].join(',');
      graph.push(`${audio},atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${index}]`);
    }
  });
  const inputs = clips.map((_clip, index) => `[v${index}]${spec.hasAudio ? `[a${index}]` : ''}`).join('');
  graph.push(`${inputs}concat=n=${clips.length}:v=1:a=${spec.hasAudio ? 1 : 0}[joined]${spec.hasAudio ? (spec.voiceovers?.length ? '[baseaudio]' : '[audio]') : ''}`);
  if (spec.voiceovers?.length) {
    spec.voiceovers.forEach((voice, index) => {
      // adelay can emit leading silence with unset PTS. Count samples before
      // trimming/mixing so those samples retain the requested timeline offset.
      graph.push(`[${index + 1}:a:0]atrim=start=${voice.offset}:duration=${voice.duration},asetpts=PTS-STARTPTS,` +
        `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${voice.muted ? 0 : voice.volume},` +
        `adelay=${Math.round(voice.start * 48000)}S:all=1,asetpts=N/SR/TB,` +
        `apad=whole_dur=${spec.duration},atrim=duration=${spec.duration}[voice${index}]`);
    });
    const mix = `${spec.hasAudio ? '[baseaudio]' : ''}${spec.voiceovers.map((_voice, index) => `[voice${index}]`).join('')}`;
    graph.push(`${mix}amix=inputs=${spec.voiceovers.length + (spec.hasAudio ? 1 : 0)}:duration=longest:dropout_transition=0:normalize=0,` +
      `alimiter=limit=0.95:level=false:latency=1,atrim=duration=${spec.duration}[audio]`);
  }
  graph.push(`[joined]${spec.text ? textFilter(spec) : 'null'}[video]`);
  return graph.join(';\n');
}

export function exportArguments(sourcePath, spec, voiceoverFiles = []) {
  const filters = [...geometryFilters(spec), ...(spec.text ? [textFilter(spec)] : [])];
  const sourceArguments = spec.clips || spec.voiceovers?.length
    ? ['-i', sourcePath, ...voiceoverFiles.flatMap((voice) => ['-protocol_whitelist', 'file', '-i', voice.filePath]),
      '-filter_complex_threads', '2', '-filter_complex_script', 'timeline.ffgraph',
      '-map', '[video]', ...(spec.hasAudio || spec.voiceovers?.length ? ['-map', '[audio]'] : [])]
    : ['-ss', String(spec.start), '-i', sourcePath, '-map', '0:v:0', '-map', '0:a:0?', '-vf', filters.join(',')];
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...sourceArguments, '-t', String(spec.duration), '-r', String(spec.fps),
    '-c:v', spec.codec === 'hevc' ? 'libx265' : 'libx264',
    ...(spec.codec === 'hevc' ? ['-x265-params', 'pools=2:frame-threads=2:log-level=error', '-tag:v', 'hvc1'] : []),
    '-preset', 'veryfast', '-crf', String(spec.crf),
    '-pix_fmt', 'yuv420p', '-threads', '2',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    '-map_metadata', '-1', '-progress', 'pipe:1', '-stats_period', '0.2',
    `export.${spec.format}`,
  ];
}
