import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

/** Label paginator Bahasa Indonesia. */
@Injectable()
export class IdPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = 'Baris per halaman:';
  override nextPageLabel = 'Halaman berikutnya';
  override previousPageLabel = 'Halaman sebelumnya';
  override firstPageLabel = 'Halaman pertama';
  override lastPageLabel = 'Halaman terakhir';
  override getRangeLabel = (page: number, size: number, length: number) => {
    if (length === 0 || size === 0) return `0 dari ${length}`;
    const start = page * size;
    return `${start + 1}–${Math.min(start + size, length)} dari ${length}`;
  };
}
