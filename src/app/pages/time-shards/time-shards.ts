import { Component, computed, effect, inject, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser, NgClass, DatePipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimeShardsProofService, SealReceipt } from './time-shards.service';

const STORAGE_KEY = 'time-shards-v2';
const GENESIS_HASH = '0'.repeat(64);

type ShardSide = 'Artist' | 'Client' | 'Both';
type FilterSide = 'All' | ShardSide;
type ShardKind = 'Note' | 'Milestone' | 'Letter';
type LetterType = 'Proposal' | 'Change' | 'Acceptance';
type LetterStatus = 'draft' | 'sent' | 'confirmed';
type MilestoneFilter = 'all' | 'unbound' | string;

interface ArtifactMeta {
  name: string;
  size: number;
  mime: string;
  sha256: string; // hex64
  hashedAt: string;
  note?: string;
}

interface SealMeta {
  sealedAt: string; // server time
  prevHash: string; // hex64
  entryHash: string; // hex64
  entryVersion: number; // 1
  toolVersion: number; // 2
  signature: string; // base64url
}

interface LetterFields {
  deliverables: string;
  usage: string;
  deadline: string;
  revisions: string;
  acceptance: string;
  scopeBoundaries: string;
  references: string;
}

interface MilestoneMeta {
  dueAt?: string;
  status?: 'planned' | 'in_progress' | 'done';
}

interface LetterMeta {
  type: LetterType;
  milestoneId?: string;
  baseLetterId?: string;
  version: number;
  status: LetterStatus;
  sentAt?: string;
  confirmedAt?: string;
  confirmedBy?: ShardSide;
  fields: LetterFields;

  lockedSnapshot?: {
    label: string;
    details: string;
    fields: LetterFields;
    lockedAt: string;
  };
}

interface TimeShard {
  id: string;
  kind: ShardKind;

  side: ShardSide;
  label: string;
  details: string;
  createdAt: string;

  milestone?: MilestoneMeta;
  letter?: LetterMeta;

  milestoneId?: string;
  artifacts?: ArtifactMeta[];
  seal?: SealMeta;
  ownerDeleteToken?: string;
}

interface TimeShardProject {
  id: string;
  name: string;
  summary?: string;
  createdAt: string;
  shards: TimeShard[];
}

interface ExportPayload {
  version: number;
  exportedAt: string;
  projects: TimeShardProject[];
}

@Component({
  selector: 'app-time-shards',
  standalone: true,
  imports: [NgClass, FormsModule, DatePipe, CommonModule],
  templateUrl: './time-shards.html',
  styleUrl: './time-shards.scss',
})
export class TimeShards {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private proofService = inject(TimeShardsProofService);
  private location = inject(Location);

  // ---------- state ----------
  projects = signal<TimeShardProject[]>([]);
  currentProjectIndex = signal<number>(-1);

  // ---------- filters ----------
  filterSide = signal<FilterSide>('All');
  searchTerm = signal<string>('');
  filterMilestone = signal<MilestoneFilter>('all');

  // ---------- form state ----------
  shardKind = signal<ShardKind>('Note');
  shardSide = signal<ShardSide>('Artist');
  shardLabel = signal<string>('');
  shardDetails = signal<string>('');

  // milestone form
  milestoneDueAt = signal<string>('');
  milestoneStatus = signal<'planned' | 'in_progress' | 'done'>('planned');

  // letter form
  letterType = signal<LetterType>('Proposal');
  letterMilestoneId = signal<string>('');
  letterBaseId = signal<string>('');
  letterStatus = signal<LetterStatus>('draft');

  // note binding
  noteMilestoneId = signal<string>('');

  // structured fields (Letter only)
  lfDeliverables = signal<string>('');
  lfUsage = signal<string>('');
  lfDeadline = signal<string>('');
  lfRevisions = signal<string>('2');
  lfAcceptance = signal<string>('');
  lfScope = signal<string>('');
  lfRefs = signal<string>('');

  // artifacts input note (optional per add)
  artifactNote = signal<string>('');

  // editing
  editingShardId = signal<string | null>(null);

  showExportSummary = signal(false);
  exportStats = signal<{
    projectCount: number;
    shardCount: number;
    projects: { name: string; count: number }[];
    fileName: string;
  } | null>(null);

  // ---------- computeds ----------
  hasProjects = computed(() => this.projects().length > 0);

  currentProject = computed<TimeShardProject | null>(() => {
    const list = this.projects();
    const idx = this.currentProjectIndex();
    if (idx < 0 || idx >= list.length) return null;
    return list[idx];
  });

  shardsForCurrentProject = computed<TimeShard[]>(() => {
    const p = this.currentProject();
    if (!p) return [];
    return [...p.shards].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  });

  milestonesForCurrentProject = computed<TimeShard[]>(() => {
    return this.shardsForCurrentProject().filter((s) => s.kind === 'Milestone');
  });

  milestoneTitleById = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const m of this.milestonesForCurrentProject()) {
      map[m.id] = m.label || '(untitled milestone)';
    }
    return map;
  });

  milestoneSpine = computed<TimeShard[]>(() => {
    const ms = this.milestonesForCurrentProject();
    return [...ms].sort((a, b) => {
      const da = a.milestone?.dueAt || '9999-12-31';
      const db = b.milestone?.dueAt || '9999-12-31';
      if (da !== db) return da.localeCompare(db);
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  });

  linkedItemCountByMilestoneId = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const m of this.milestonesForCurrentProject()) map[m.id] = 0;

    for (const s of this.shardsForCurrentProject()) {
      if (s.kind === 'Milestone') continue;
      const bound = s.kind === 'Letter' ? (s.letter?.milestoneId ?? s.milestoneId) : s.milestoneId;
      if (bound) map[bound] = (map[bound] ?? 0) + 1;
    }
    return map;
  });

  milestoneFilterLabel = computed(() => {
    const f = this.filterMilestone();
    if (f === 'all') return 'All';
    if (f === 'unbound') return 'Unbound';
    return this.milestoneTitleById()[f] ?? 'Unknown milestone';
  });

  visibleShards = computed<TimeShard[]>(() => {
    let list = this.shardsForCurrentProject();
    const side = this.filterSide();
    const q = this.searchTerm().trim().toLowerCase();
    const mf = this.filterMilestone();

    if (side !== 'All') list = list.filter((s) => s.side === side);

    if (q) {
      list = list.filter((s) => {
        const extra =
          s.kind === 'Letter'
            ? JSON.stringify(s.letter?.fields ?? {})
            : s.kind === 'Milestone'
              ? JSON.stringify(s.milestone ?? {})
              : '';
        const seal = s.seal ? JSON.stringify(s.seal) : '';
        return (
          (s.label || '').toLowerCase().includes(q) ||
          (s.details || '').toLowerCase().includes(q) ||
          extra.toLowerCase().includes(q) ||
          seal.toLowerCase().includes(q)
        );
      });
    }

    if (mf !== 'all') {
      list = list.filter((s) => {
        if (mf === 'unbound') {
          if (s.kind === 'Milestone') return false;
          const bound =
            s.kind === 'Letter' ? (s.letter?.milestoneId ?? s.milestoneId) : s.milestoneId;
          return !bound;
        }
        if (s.kind === 'Milestone') return s.id === mf;
        const bound =
          s.kind === 'Letter' ? (s.letter?.milestoneId ?? s.milestoneId) : s.milestoneId;
        return bound === mf;
      });
    }
    return list;
  });

  isEditing = computed(() => this.editingShardId() !== null);

  letterPreviewText = computed(() => {
    if (this.shardKind() !== 'Letter') return '';
    return this.buildLetterText({
      id: 'preview',
      kind: 'Letter',
      side: this.shardSide(),
      label: this.shardLabel(),
      details: this.shardDetails(),
      createdAt: new Date().toISOString(),
      milestoneId: this.letterMilestoneId().trim() || undefined,
      letter: {
        type: this.letterType(),
        milestoneId: this.letterMilestoneId().trim() || undefined,
        baseLetterId: this.letterBaseId().trim() || undefined,
        version: 1,
        status: this.letterStatus(),
        fields: this.collectLetterFields(),
      },
    } as TimeShard);
  });

  constructor() {
    this.restoreFromStorage();

    effect(() => {
      if (!this.isBrowser) return;
      const payload: ExportPayload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        projects: this.projects(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    });
  }

  goBack() {
    this.location.back();
  }

  // ---------- utils ----------
  private newId(): string {
    if (
      this.isBrowser &&
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
    return 'id-' + Math.random().toString(36).slice(2);
  }

  private collectLetterFields(): LetterFields {
    return {
      deliverables: this.lfDeliverables().trim(),
      usage: this.lfUsage().trim(),
      deadline: this.lfDeadline().trim(),
      revisions: this.lfRevisions().trim(),
      acceptance: this.lfAcceptance().trim(),
      scopeBoundaries: this.lfScope().trim(),
      references: this.lfRefs().trim(),
    };
  }

  // note + letter 支持返回绑定 milestone
  boundMilestoneIdOf(s: TimeShard): string | null {
    if (!s || s.kind === 'Milestone') return null;
    if (s.kind === 'Letter') return s.letter?.milestoneId ?? s.milestoneId ?? null;
    return s.milestoneId ?? null;
  }

  applyMilestoneFilter(milestoneId: string) {
    if (!milestoneId) return;
    this.filterMilestone.set(milestoneId);
    this.searchTerm.set('');
  }

  clearMilestoneFilter() {
    this.filterMilestone.set('all');
  }

  // ---------- storage ----------
  private restoreFromStorage() {
    if (!this.isBrowser) return;
    const rawV2 = localStorage.getItem(STORAGE_KEY);
    const rawV1 = localStorage.getItem('time-shards-v1');
    const raw = rawV2 ?? rawV1;

    if (!raw) {
      const demo: TimeShardProject = {
        id: this.newId(),
        name: 'My first commission',
        summary: '',
        createdAt: new Date().toISOString(),
        shards: [],
      };
      this.projects.set([demo]);
      this.currentProjectIndex.set(0);
      return;
    }

    try {
      const parsed: ExportPayload = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.projects)) {
        const version = Number((parsed as any).version ?? 1);
        const safe = this.importProjects(parsed.projects, version);
        this.projects.set(safe);
        this.currentProjectIndex.set(safe.length ? 0 : -1);
      }
    } catch (e) {
      console.error('Failed to parse Time-Shards storage', e);
    }
  }

  private resetFormState() {
    this.shardKind.set('Note');
    this.shardSide.set('Artist');
    this.shardLabel.set('');
    this.shardDetails.set('');
    this.milestoneDueAt.set('');
    this.milestoneStatus.set('planned');
    this.letterType.set('Proposal');
    this.letterMilestoneId.set('');
    this.letterBaseId.set('');
    this.letterStatus.set('draft');
    this.noteMilestoneId.set('');
    this.lfDeliverables.set('');
    this.lfUsage.set('');
    this.lfDeadline.set('');
    this.lfRevisions.set('2');
    this.lfAcceptance.set('');
    this.lfScope.set('');
    this.lfRefs.set('');
    this.artifactNote.set('');
    this.editingShardId.set(null);
  }

  // ---------- project management ----------
  addProject(input: HTMLInputElement) {
    const name = input.value.trim();
    if (!name) return;

    const project: TimeShardProject = {
      id: this.newId(),
      name,
      summary: '',
      createdAt: new Date().toISOString(),
      shards: [],
    };

    const list = [...this.projects(), project];
    this.projects.set(list);
    this.currentProjectIndex.set(list.length - 1);
    this.resetFormState();
    input.value = '';
  }

  selectProject(idx: number) {
    this.currentProjectIndex.set(idx);
    this.resetFormState();
  }

  deleteCurrentProject() {
    const idx = this.currentProjectIndex();
    const list = [...this.projects()];
    if (idx < 0 || idx >= list.length) return;

    list.splice(idx, 1);
    this.projects.set(list);

    if (!list.length) this.currentProjectIndex.set(-1);
    else this.currentProjectIndex.set(Math.max(0, idx - 1));

    this.resetFormState();
  }

  onSummaryChange(value: string) {
    const idx = this.currentProjectIndex();
    const list = [...this.projects()];
    if (idx < 0 || idx >= list.length) return;

    const target = list[idx];
    list[idx] = { ...target, summary: value };
    this.projects.set(list);
  }

  // ---------- shard behaviors ----------
  saveShard() {
    const project = this.currentProject();
    if (!project) return;

    const kind = this.shardKind();
    const side = this.shardSide();
    const label = this.shardLabel().trim();
    const details = this.shardDetails().trim();

    if (!label && !details && kind !== 'Milestone') return;
    if (kind === 'Milestone' && !label) return;

    const list = [...this.projects()];
    const idx = this.currentProjectIndex();
    const target = list[idx];
    const editingId = this.editingShardId();

    if (editingId) {
      const existing = target.shards.find((s) => s.id === editingId);
      if (existing?.seal) {
        alert('此记录已在线封存。编辑将破坏证明。请复制一条新记录。');
        return;
      }
    }

    if (editingId) {
      const updatedShards = target.shards.map((s): TimeShard => {
        if (s.id !== editingId) return s;

        if (kind === 'Milestone') {
          return {
            ...s,
            kind: 'Milestone',
            side,
            label: label || '(untitled milestone)',
            details,
            milestoneId: undefined,
            milestone: {
              dueAt: this.milestoneDueAt().trim() || undefined,
              status: this.milestoneStatus(),
            },
            letter: undefined,
          };
        }

        if (kind === 'Letter') {
          const prevVersion = s.letter?.version ?? 1;
          const msId = this.letterMilestoneId().trim() || undefined;

          return {
            ...s,
            kind: 'Letter',
            side,
            label: label || '(no subject)',
            details,
            milestone: undefined,
            milestoneId: msId,
            letter: {
              type: this.letterType(),
              milestoneId: msId,
              baseLetterId: this.letterBaseId().trim() || undefined,
              version: prevVersion + 1,
              status: this.letterStatus(),
              sentAt: s.letter?.sentAt,
              confirmedAt: s.letter?.confirmedAt,
              confirmedBy: s.letter?.confirmedBy,
              fields: this.collectLetterFields(),
              lockedSnapshot: s.letter?.lockedSnapshot,
            },
          };
        }

        return {
          ...s,
          kind: 'Note',
          side,
          label: label || '(no label)',
          details,
          milestoneId: this.noteMilestoneId().trim() || undefined,
          milestone: undefined,
          letter: undefined,
        };
      });

      list[idx] = { ...target, shards: updatedShards };
      this.projects.set(list);
      this.resetFormState();
      return;
    }

    const now = new Date().toISOString();
    let shard: TimeShard;

    if (kind === 'Milestone') {
      shard = {
        id: this.newId(),
        kind: 'Milestone',
        side,
        label: label || '(untitled milestone)',
        details,
        createdAt: now,
        milestone: {
          dueAt: this.milestoneDueAt().trim() || undefined,
          status: this.milestoneStatus(),
        },
      };
    } else if (kind === 'Letter') {
      const msId = this.letterMilestoneId().trim() || undefined;
      shard = {
        id: this.newId(),
        kind: 'Letter',
        side,
        label: label || '(no subject)',
        details,
        createdAt: now,
        milestoneId: msId,
        letter: {
          type: this.letterType(),
          milestoneId: msId,
          baseLetterId: this.letterBaseId().trim() || undefined,
          version: 1,
          status: this.letterStatus(),
          fields: this.collectLetterFields(),
        },
      };
    } else {
      shard = {
        id: this.newId(),
        kind: 'Note',
        side,
        label: label || '(no label)',
        details,
        createdAt: now,
        milestoneId: this.noteMilestoneId().trim() || undefined,
      };
    }

    list[idx] = { ...target, shards: [...target.shards, shard] };
    this.projects.set(list);

    // rapid entry
    this.shardLabel.set('');
    this.shardDetails.set('');
  }

  clearShardForm() {
    this.shardLabel.set('');
    this.shardDetails.set('');
  }

  startEditShard(shard: TimeShard) {
    if (shard.seal) {
      alert('此记录已封存。编辑将破坏证明。');
      return;
    }

    this.editingShardId.set(shard.id);
    this.shardKind.set(shard.kind);
    this.shardSide.set(shard.side);
    this.shardLabel.set(shard.label);
    this.shardDetails.set(shard.details);

    if (shard.kind === 'Milestone') {
      this.milestoneDueAt.set(shard.milestone?.dueAt ?? '');
      this.milestoneStatus.set(shard.milestone?.status ?? 'planned');
    } else {
      this.milestoneDueAt.set('');
      this.milestoneStatus.set('planned');
    }

    if (shard.kind === 'Letter') {
      this.letterType.set(shard.letter?.type ?? 'Proposal');
      this.letterMilestoneId.set(shard.letter?.milestoneId ?? shard.milestoneId ?? '');
      this.letterBaseId.set(shard.letter?.baseLetterId ?? '');
      this.letterStatus.set(shard.letter?.status ?? 'draft');

      const f = shard.letter?.fields;
      this.lfDeliverables.set(f?.deliverables ?? '');
      this.lfUsage.set(f?.usage ?? '');
      this.lfDeadline.set(f?.deadline ?? '');
      this.lfRevisions.set(f?.revisions ?? '2');
      this.lfAcceptance.set(f?.acceptance ?? '');
      this.lfScope.set(f?.scopeBoundaries ?? '');
      this.lfRefs.set(f?.references ?? '');
    } else {
      this.letterType.set('Proposal');
      this.letterMilestoneId.set('');
      this.letterBaseId.set('');
      this.letterStatus.set('draft');

      this.lfDeliverables.set('');
      this.lfUsage.set('');
      this.lfDeadline.set('');
      this.lfRevisions.set('2');
      this.lfAcceptance.set('');
      this.lfScope.set('');
      this.lfRefs.set('');
    }

    if (shard.kind === 'Note') this.noteMilestoneId.set(shard.milestoneId ?? '');
    else this.noteMilestoneId.set('');
  }

  cancelEditShard() {
    this.resetFormState();
  }

  deleteShard(id: string) {
    const project = this.currentProject();
    if (!project) return;

    const target = project.shards.find((s) => s.id === id);
    if (target?.seal) {
      alert('此记录已在线封存。如果确实需要移除公开证明，请先撤销它。');
      return;
    }

    if (this.isBrowser) {
      const ok = confirm('确定要删除此记录吗？此操作无法撤销。');
      if (!ok) return;
    }

    const list = [...this.projects()];
    const idx = this.currentProjectIndex();
    const p = list[idx];
    list[idx] = { ...p, shards: p.shards.filter((s) => s.id !== id) };
    this.projects.set(list);

    if (this.editingShardId() === id) this.resetFormState();
  }

  // ---------- letter actions ----------
  markLetterSent(id: string) {
    this.updateShard(id, (s) => {
      if (s.kind !== 'Letter' || !s.letter) return s;
      if (s.letter.status === 'confirmed') return s;
      return {
        ...s,
        letter: { ...s.letter, status: 'sent', sentAt: new Date().toISOString() },
      };
    });
  }

  confirmLetter(id: string, confirmedBy: ShardSide) {
    this.updateShard(id, (s) => {
      if (s.kind !== 'Letter' || !s.letter) return s;
      if (s.letter.status === 'confirmed') return s;

      const lockedAt = new Date().toISOString();
      return {
        ...s,
        letter: {
          ...s.letter,
          status: 'confirmed',
          confirmedAt: lockedAt,
          confirmedBy,
          lockedSnapshot: {
            label: s.label,
            details: s.details,
            fields: s.letter.fields,
            lockedAt,
          },
        },
      };
    });
  }

  createChangeLetterFrom(base: TimeShard) {
    if (base.kind !== 'Letter' || !base.letter) return;

    this.editingShardId.set(null);
    this.shardKind.set('Letter');

    // 保留当前 side 选择（你想改成 base.side 也行）
    this.shardSide.set(this.shardSide());

    this.letterType.set('Change');
    this.letterMilestoneId.set(base.letter.milestoneId ?? base.milestoneId ?? '');
    this.letterBaseId.set(base.id);
    this.letterStatus.set('draft');

    this.shardLabel.set(`Change: ${base.label}`);
    this.shardDetails.set('');

    const f = base.letter.fields;
    this.lfDeliverables.set(f.deliverables ?? '');
    this.lfUsage.set(f.usage ?? '');
    this.lfDeadline.set(f.deadline ?? '');
    this.lfRevisions.set(f.revisions ?? '2');
    this.lfAcceptance.set(f.acceptance ?? '');
    this.lfScope.set(f.scopeBoundaries ?? '');
    this.lfRefs.set(f.references ?? '');
  }

  copyLetterTextFromShard(shard: TimeShard) {
    if (!this.isBrowser) return;
    if (shard.kind !== 'Letter') return;
    this.copyText(this.buildLetterText(shard), '信函内容已复制到剪贴板。');
  }

  copyLetterTextFromForm() {
    if (!this.isBrowser) return;
    if (this.shardKind() !== 'Letter') return;
    this.copyText(this.letterPreviewText(), '信函内容已复制到剪贴板。');
  }

  private buildLetterText(shard: TimeShard): string {
    const l = shard.letter!;
    const titleMap = this.milestoneTitleById();
    const msTitle = l.milestoneId ? titleMap[l.milestoneId] : '';

    const lines: string[] = [];
    const typeLabel = l.type === 'Proposal' ? '提案' : l.type === 'Change' ? '变更请求' : '确认函';

    lines.push(`${typeLabel}${msTitle ? ` · 里程碑: ${msTitle}` : ''}`);
    lines.push(`主题: ${shard.label}`);
    lines.push('');

    const f = l.fields ?? this.collectLetterFields();
    const pushField = (k: string, v: string) => {
      const vv = (v ?? '').trim();
      if (!vv) return;
      lines.push(`- ${k}: ${vv}`);
    };

    pushField('交付内容', f.deliverables);
    pushField('用途', f.usage);
    pushField('截止日期', f.deadline);
    pushField('修改次数', f.revisions);
    pushField('验收标准', f.acceptance);
    pushField('范围边界', f.scopeBoundaries);
    pushField('参考资料', f.references);

    if (lines[lines.length - 1] !== '') lines.push('');
    if ((shard.details ?? '').trim()) {
      lines.push(shard.details.trim());
      lines.push('');
    }

    if (l.status === 'confirmed' && l.confirmedAt) {
      lines.push(
        `(确认于 ${l.confirmedAt}${l.confirmedBy ? ` 由 ${l.confirmedBy === 'Artist' ? '创作者' : l.confirmedBy === 'Client' ? '客户' : '双方'}` : ''})`,
      );
    }

    return lines.join('\n');
  }

  // ---------- artifacts (local hash only) ----------
  async onArtifactFilesSelected(ev: Event, shardId: string) {
    if (!this.isBrowser) return;
    const input = ev.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) return;

    for (const f of files) {
      const sha256 = await this.hashFileSha256Hex(f);
      this.addArtifactToShard(shardId, {
        name: f.name,
        size: f.size,
        mime: f.type || 'application/octet-stream',
        sha256,
        hashedAt: new Date().toISOString(),
        note: this.artifactNote().trim() || undefined,
      });
    }

    input.value = '';
    this.artifactNote.set('');
  }

  private addArtifactToShard(shardId: string, a: ArtifactMeta) {
    this.updateShard(shardId, (s) => {
      const list = Array.isArray(s.artifacts) ? [...s.artifacts] : [];
      list.push(a);
      return { ...s, artifacts: list };
    });
  }

  removeArtifact(shardId: string, idx: number) {
    this.updateShard(shardId, (s) => {
      const list = Array.isArray(s.artifacts) ? [...s.artifacts] : [];
      list.splice(idx, 1);
      return { ...s, artifacts: list };
    });
  }

  private async hashFileSha256Hex(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const dig = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(dig);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- proof: stable stringify + entry hash ----------
  private stableStringify(v: any): string {
    if (v === null || v === undefined) return 'null';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map((x) => this.stableStringify(x)).join(',') + ']';
    const keys = Object.keys(v).sort();
    return (
      '{' + keys.map((k) => JSON.stringify(k) + ':' + this.stableStringify(v[k])).join(',') + '}'
    );
  }

  private async sha256Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const dig = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(dig);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private getLatestSealedHash(project: TimeShardProject): string {
    const sealed = project.shards
      .filter((s) => !!s.seal?.entryHash)
      .sort((a, b) => (b.seal!.sealedAt || '').localeCompare(a.seal!.sealedAt || ''));
    return sealed.length ? sealed[0].seal!.entryHash : GENESIS_HASH;
  }

  private async computeEntryHash(
    project: TimeShardProject,
    shard: TimeShard,
    prevHash: string,
  ): Promise<string> {
    const artifactsHashes = (shard.artifacts ?? []).map((a) => a.sha256);
    const payload = {
      tool: 'time-shards',
      toolVersion: 2,
      projectId: project.id,
      projectName: project.name,
      shard: {
        id: shard.id,
        kind: shard.kind,
        side: shard.side,
        label: shard.label,
        details: shard.details,
        createdAt: shard.createdAt,
        milestoneId: shard.milestoneId ?? null,
        milestone: shard.milestone ?? null,
        letter: shard.letter ?? null,
      },
      artifacts: artifactsHashes,
      prevHash,
    };
    const stable = this.stableStringify(payload);
    return await this.sha256Hex(stable);
  }

  // ---------- proof: seal / verify / revoke ----------
  async sealShardOnline(shardId: string) {
    if (!this.isBrowser) return;

    const project = this.currentProject();
    if (!project) return;

    const shard = project.shards.find((s) => s.id === shardId);
    if (!shard) return;

    if (shard.seal?.entryHash) {
      alert(shard?.seal ? '已经封存。' : '未找到记录。');
      return;
    }

    const isMock = true;

    // Minimal notice
    const confirmMsg = isMock
      ? '在线封存将仅上传哈希值（entryHash/prevHash/artifacts sha256）用于公开验证。\n\n不会上传任何具体内容。\n\n是否继续？'
      : 'Seal online will upload ONLY hashes...\n\nContinue?';

    if (!confirm(confirmMsg)) return;
    const prevHash = this.getLatestSealedHash(project);
    const entryHash = await this.computeEntryHash(project, shard, prevHash);
    const artifacts = (shard.artifacts ?? []).map((a) => a.sha256);
    try {
      const result = await this.proofService.sealEntry({
        entryHash,
        prevHash,
        artifacts,
        toolVersion: 2,
        entryVersion: 1,
      });

      this.updateShard(shardId, (s) => ({
        ...s,
        seal: { ...result.receipt },
        ownerDeleteToken: result.ownerDeleteToken ?? s.ownerDeleteToken,
      }));
      alert(isMock ? '封存成功！（模拟模式）' : '封存成功！');
    } catch (error) {
      alert('封存失败：服务未配置或网络错误。');
      console.error(error);
    }
  }

  openVerify(shard: TimeShard) {
    if (!shard.seal?.entryHash) return;
    // 暂时跳转到一个本地的验证页面或显示弹窗
    alert(`验证哈希：${shard.seal.entryHash}\n(验证页面待实现)`);
  }

  copyPublicReceipt(shard: TimeShard) {
    if (!shard.seal) return;
    const publicReceipt = { version: 1, ...shard.seal };
    this.copyText(JSON.stringify(publicReceipt, null, 2), '公开回执已复制。');
  }

  copyOwnerReceipt(shard: TimeShard) {
    if (!shard.seal) return;
    const ownerReceipt = { version: 1, ...shard.seal, ownerDeleteToken: shard.ownerDeleteToken };
    this.copyText(JSON.stringify(ownerReceipt, null, 2), '所有者回执已复制。');
  }

  async revokeSealOnline(shard: TimeShard) {
    if (!shard.seal || !shard.ownerDeleteToken) {
      alert('未找到令牌或未封存。');
      return;
    }
    if (!confirm('确定要撤销此封存吗？（模拟）')) return;

    try {
      await this.proofService.revokeEntry(shard.seal.entryHash, shard.ownerDeleteToken);
      alert('已撤销（模拟）。');
      // 实际逻辑应更新 seal 状态或移除
    } catch (e) {
      alert('撤销失败。');
    }
  }

  // ---------- shared updateShard ----------
  private updateShard(id: string, updater: (s: TimeShard) => TimeShard) {
    const project = this.currentProject();
    if (!project) return;
    const list = [...this.projects()];
    const idx = this.currentProjectIndex();
    const target = list[idx];
    list[idx] = { ...target, shards: target.shards.map((s) => (s.id === id ? updater(s) : s)) };
    this.projects.set(list);
  }

  // ---------- export / import ----------
  exportJson() {
    const currentProjects = this.projects();

    // 1. 基础校验
    if (!currentProjects || currentProjects.length === 0) {
      alert('暂无项目可导出。请先创建项目并添加记录。');
      return;
    }

    // 2. 统计数据 (用于展示给用户)
    const projectCount = currentProjects.length;
    const shardCount = currentProjects.reduce((acc, p) => acc + p.shards.length, 0);
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // 生成友好的文件名
    const fileName = `TimeShards_${projectCount}个项目_${shardCount}条记录_${dateStr}.json`;

    // 准备预览数据 (只取名称和数量，保护隐私且清晰)
    const previewList = currentProjects.map((p) => ({
      name: p.name,
      count: p.shards.length,
    }));

    // 3. 序列化数据 (使用 2 空格缩进，方便人类阅读，同时保持 UTF-8)
    // 注意：JSON.stringify 默认处理 Unicode，但在某些旧系统可能需要 BOM，现代浏览器通常不需要
    const jsonString = JSON.stringify(currentProjects, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });

    // 4. 触发下载
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;

    // 模拟点击
    document.body.appendChild(link);
    link.click();

    // 清理
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // 5. 显示成功摘要模态框 (关键体验提升)
    this.exportStats.set({
      projectCount,
      shardCount,
      projects: previewList,
      fileName,
    });

    // 延迟一点点显示，让下载动作先发生，避免阻塞 UI
    setTimeout(() => {
      this.showExportSummary.set(true);
    }, 300);
  }

  // 新增：关闭摘要模态框
  closeExportSummary() {
    this.showExportSummary.set(false);
    // 可选：清空统计信息以节省内存
    setTimeout(() => this.exportStats.set(null), 300);
  }

  onImportFileSelected(event: Event) {
    if (!this.isBrowser) return;

    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const projectsRaw = Array.isArray(parsed) ? parsed : parsed.projects || [];
        const safe = this.importProjects(projectsRaw, parsed.version || 1);
        this.projects.set(safe);
        this.currentProjectIndex.set(safe.length ? 0 : -1);
        alert(`已导入 ${safe.length} 个项目。`);
      } catch (e) {
        alert('导入失败。');
      }
      input.value = '';
    };
    reader.onerror = () => {
      alert('导入失败：无法读取文件。');
      input.value = '';
    };
    reader.readAsText(file);
  }

  private importProjects(projects: any[], version: number): TimeShardProject[] {
    return projects.map((p: any) => ({
      id: p.id || this.newId(),
      name: p.name || 'Untitled',
      summary: p.summary || '',
      createdAt: p.createdAt || new Date().toISOString(),
      shards: (p.shards || []).map((s: any) => this.importShard(s, version)),
    }));
  }

  private importShard(s: any, version: number): TimeShard {
    const createdAt = typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString();

    const artifacts: ArtifactMeta[] | undefined = Array.isArray(s.artifacts)
      ? s.artifacts.map((a: any) => ({
          name: String(a.name ?? 'file'),
          size: Number(a.size ?? 0),
          mime: String(a.mime ?? 'application/octet-stream'),
          sha256: String(a.sha256 ?? ''),
          hashedAt: typeof a.hashedAt === 'string' ? a.hashedAt : createdAt,
          note: typeof a.note === 'string' ? a.note : undefined,
        }))
      : undefined;

    const seal: SealMeta | undefined =
      s.seal && typeof s.seal === 'object'
        ? {
            sealedAt: String(s.seal.sealedAt ?? ''),
            prevHash: String(s.seal.prevHash ?? GENESIS_HASH),
            entryHash: String(s.seal.entryHash ?? ''),
            entryVersion: Number(s.seal.entryVersion ?? 1),
            toolVersion: Number(s.seal.toolVersion ?? 2),
            signature: String(s.seal.signature ?? ''),
          }
        : undefined;

    const base: TimeShard = {
      id: typeof s.id === 'string' ? s.id : this.newId(),
      kind: (['Note', 'Milestone', 'Letter'] as ShardKind[]).includes(s.kind) ? s.kind : 'Note',
      side: (['Artist', 'Client', 'Both'] as ShardSide[]).includes(s.side) ? s.side : 'Artist',
      label: String(s.label ?? '(no label)'),
      details: String(s.details ?? ''),
      createdAt,
      milestoneId: typeof s.milestoneId === 'string' ? s.milestoneId : undefined,
      artifacts,
      seal,
      ownerDeleteToken: typeof s.ownerDeleteToken === 'string' ? s.ownerDeleteToken : undefined,
    };

    // v1 compatibility (simple)
    if (version <= 1) {
      base.kind = 'Note';
      return base;
    }

    if (base.kind === 'Milestone') {
      base.milestone = {
        dueAt: typeof s.milestone?.dueAt === 'string' ? s.milestone.dueAt : undefined,
        status: (['planned', 'in_progress', 'done'] as const).includes(s.milestone?.status)
          ? s.milestone.status
          : 'planned',
      };
      base.milestoneId = undefined;
      base.letter = undefined;
      return base;
    }

    if (base.kind === 'Letter') {
      const f: LetterFields = {
        deliverables: String(s.letter?.fields?.deliverables ?? ''),
        usage: String(s.letter?.fields?.usage ?? ''),
        deadline: String(s.letter?.fields?.deadline ?? ''),
        revisions: String(s.letter?.fields?.revisions ?? '2'),
        acceptance: String(s.letter?.fields?.acceptance ?? ''),
        scopeBoundaries: String(s.letter?.fields?.scopeBoundaries ?? ''),
        references: String(s.letter?.fields?.references ?? ''),
      };

      base.letter = {
        type: (['Proposal', 'Change', 'Acceptance'] as LetterType[]).includes(s.letter?.type)
          ? s.letter.type
          : 'Proposal',
        milestoneId: typeof s.letter?.milestoneId === 'string' ? s.letter.milestoneId : undefined,
        baseLetterId:
          typeof s.letter?.baseLetterId === 'string' ? s.letter.baseLetterId : undefined,
        version: Number(s.letter?.version ?? 1),
        status: (['draft', 'sent', 'confirmed'] as LetterStatus[]).includes(s.letter?.status)
          ? s.letter.status
          : 'draft',
        sentAt: typeof s.letter?.sentAt === 'string' ? s.letter.sentAt : undefined,
        confirmedAt: typeof s.letter?.confirmedAt === 'string' ? s.letter.confirmedAt : undefined,
        confirmedBy: (['Artist', 'Client', 'Both'] as ShardSide[]).includes(s.letter?.confirmedBy)
          ? s.letter.confirmedBy
          : undefined,
        fields: f,
        lockedSnapshot: s.letter?.lockedSnapshot
          ? {
              label: String(s.letter.lockedSnapshot.label ?? base.label),
              details: String(s.letter.lockedSnapshot.details ?? base.details),
              fields: {
                deliverables: String(
                  s.letter.lockedSnapshot.fields?.deliverables ?? f.deliverables,
                ),
                usage: String(s.letter.lockedSnapshot.fields?.usage ?? f.usage),
                deadline: String(s.letter.lockedSnapshot.fields?.deadline ?? f.deadline),
                revisions: String(s.letter.lockedSnapshot.fields?.revisions ?? f.revisions),
                acceptance: String(s.letter.lockedSnapshot.fields?.acceptance ?? f.acceptance),
                scopeBoundaries: String(
                  s.letter.lockedSnapshot.fields?.scopeBoundaries ?? f.scopeBoundaries,
                ),
                references: String(s.letter.lockedSnapshot.fields?.references ?? f.references),
              },
              lockedAt: String(s.letter.lockedSnapshot.lockedAt ?? base.createdAt),
            }
          : undefined,
      };

      base.milestoneId = base.letter.milestoneId ?? base.milestoneId;
      return base;
    }

    base.kind = 'Note';
    base.letter = undefined;
    base.milestone = undefined;
    return base;
  }

  // ---------- copy ----------
  private copyText(text: string, okMsg: string) {
    if (this.isBrowser && navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => alert(okMsg))
        .catch(() => this.fallbackCopy(text));
    } else {
      this.fallbackCopy(text);
    }
  }

  private fallbackCopy(text: string) {
    if (!this.isBrowser || typeof window === 'undefined') {
      console.log(text);
      return;
    }
    try {
      const short = text.length > 2000 ? text.slice(0, 2000) + '\n...\n(已截断)' : text;
      prompt('复制此文本:', short);
    } catch (e) {
      console.error(e);
    }
  }
}
