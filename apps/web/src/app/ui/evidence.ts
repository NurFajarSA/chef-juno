import { Component, computed, input, signal } from '@angular/core';

export interface EvidenceShot {
  id: string;
  name: string;
  src: string;
}

export interface FindingEvidence {
  status: 'reproduced' | 'not_reproduced' | 'inconclusive';
  note: string;
  goal: string;
  shots: string[];
}

const LABEL: Record<FindingEvidence['status'], string> = {
  reproduced: 'Terbukti saat dicoba di aplikasi',
  not_reproduced: 'Tidak muncul saat dicoba di aplikasi',
  inconclusive: 'Sudah dicoba, hasil belum meyakinkan',
};

/** Bukti uji aplikasi untuk satu temuan: status, catatan penilai, dan screenshot (klik untuk memperbesar). */
@Component({
  selector: 'cj-evidence',
  host: { '(document:keydown.escape)': 'zoom.set(null)' },
  template: `
    @let e = evidence();
    <div class="ev" [class]="'ev ' + e.status" data-testid="finding-evidence">
      <p class="head">
        <span class="material-symbols-rounded" aria-hidden="true">science</span>
        <b>{{ label() }}</b>
      </p>
      <p class="note">{{ e.note }}</p>
      @if (e.goal) {<p class="goal">Skenario: {{ e.goal }}</p>}
      @if (list().length) {
        <div class="shots">
          @for (s of list(); track s.id) {
            <button type="button" class="shot" [id]="'bukti-' + s.id" (click)="zoom.set(s)" [attr.aria-label]="'Perbesar screenshot ' + s.name">
              <img [src]="s.src" [alt]="'Screenshot ' + s.name" loading="lazy" />
              <span>{{ s.name }}</span>
            </button>
          }
        </div>
      }
    </div>
    @if (zoom(); as z) {
      <div class="lightbox" role="dialog" aria-modal="true" [attr.aria-label]="'Screenshot ' + z.name" (click)="zoom.set(null)">
        <img [src]="z.src" [alt]="'Screenshot ' + z.name" (click)="$event.stopPropagation()" />
        <button type="button" class="close" (click)="zoom.set(null)" aria-label="Tutup screenshot">
          <span class="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
      </div>
    }
  `,
  styles: `
    .ev { margin-top: 10px; padding: 10px 14px; border-radius: 12px; background: var(--mat-sys-surface-container-low); }
    .ev { border-left: 4px solid var(--mat-sys-outline); }
    .ev.reproduced { border-left-color: var(--mat-sys-error); }
    .ev.reproduced .head { color: var(--mat-sys-error); }
    .ev.not_reproduced { border-left-color: var(--mat-sys-primary); }
    .goal { color: var(--mat-sys-on-surface-variant); }
    .head { display: flex; align-items: center; gap: 6px; margin: 0; font: var(--mat-sys-label-large); }
    .head .material-symbols-rounded { font-size: 18px; }
    .note { margin: 4px 0 0; font: var(--mat-sys-body-medium); }
    .goal { margin: 2px 0 0; font: var(--mat-sys-body-small); }
    .shots { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .shot { display: flex; flex-direction: column; gap: 4px; padding: 0; border: 0; background: none; color: inherit; cursor: zoom-in; font: var(--mat-sys-label-small); }
    .shot img { width: 120px; height: auto; max-height: 220px; object-fit: cover; object-position: top; border-radius: 8px; border: 1px solid var(--mat-sys-outline-variant); background: #fff; }
    .shot:focus-visible img { outline: 3px solid var(--mat-sys-primary); outline-offset: 2px; }
    .lightbox { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: rgb(0 0 0 / 0.75); cursor: zoom-out; }
    .lightbox img { max-width: min(92vw, 520px); max-height: 92vh; border-radius: 12px; background: #fff; cursor: default; }
    .close { position: absolute; top: 16px; right: 16px; width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); cursor: pointer; display: grid; place-items: center; }
  `,
})
export class CjEvidence {
  readonly evidence = input.required<FindingEvidence>();
  readonly shots = input<Map<string, EvidenceShot>>(new Map());
  protected readonly zoom = signal<EvidenceShot | null>(null);
  protected readonly label = computed(() => LABEL[this.evidence().status]);
  protected readonly list = computed(() =>
    this.evidence()
      .shots.map((id) => this.shots().get(id))
      .filter((s): s is EvidenceShot => !!s),
  );
}
