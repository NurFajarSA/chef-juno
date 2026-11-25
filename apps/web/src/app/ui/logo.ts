import { Component, input } from '@angular/core';

/**
 * Logo Chef Juno: lencana bulat bergradasi merah (palet MasterChef: merah tua, emas, arang)
 * dengan topi koki putih berpita emas. Warna logo sengaja tetap (identitas merek), tidak ikut tema.
 */
@Component({
  selector: 'cj-logo',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="cj-logo-orb" cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="#F0444A" />
          <stop offset=".55" stop-color="#C8161E" />
          <stop offset="1" stop-color="#6E0A0F" />
        </radialGradient>
        <linearGradient id="cj-logo-gold" x1="0" x2="1">
          <stop offset="0" stop-color="#E9C25A" />
          <stop offset="1" stop-color="#B8871F" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#cj-logo-orb)" />
      <circle cx="20" cy="20" r="18.6" fill="none" stroke="#1E1A1A" stroke-opacity=".25" />
      <g fill="#FFFFFF">
        <circle cx="14" cy="18" r="5.6" />
        <circle cx="20" cy="14.2" r="6.6" />
        <circle cx="26" cy="18" r="5.6" />
        <rect x="12.4" y="18" width="15.2" height="8.6" />
      </g>
      <rect x="12.4" y="25.4" width="15.2" height="4" rx="1.2" fill="url(#cj-logo-gold)" />
    </svg>
  `,
  styles: `:host { display: inline-flex; line-height: 0; } svg { display: block; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / .18)); }`,
})
export class CjLogo {
  readonly size = input(36);
}
