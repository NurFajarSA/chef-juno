import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'cj-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {}
