import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CjNavRail, NAV_ITEMS } from './nav-rail';

describe('CjNavRail', () => {
  it('menampilkan semua menu berbahasa Indonesia + Pengaturan', async () => {
    TestBed.configureTestingModule({ imports: [CjNavRail], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(CjNavRail);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    for (const label of ['Review', 'Memory', 'Knowledge', 'Analitik', 'Rapor', 'Repositori', 'Mesin', 'Skills', 'Pengaturan']) {
      expect(text).toContain(label);
    }
    expect(NAV_ITEMS.length).toBe(8);
  });

  it('tombol toggle tema mengganti class di <html>', async () => {
    TestBed.configureTestingModule({ imports: [CjNavRail], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(CjNavRail);
    await fixture.whenStable();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="theme-toggle"]') as HTMLButtonElement;
    const before = document.documentElement.classList.contains('theme-dark');
    btn.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains('theme-dark')).toBe(!before);
  });
});
