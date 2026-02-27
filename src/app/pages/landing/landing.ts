import { Component, ElementRef, ViewChild } from '@angular/core';
import { RouterLink } from "@angular/router";

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  standalone: true
})
export class Landing {
  @ViewChild('landingBody') bodyRef!: ElementRef<HTMLElement>;

  howItWork() {
    const root = this.bodyRef.nativeElement;
    if(!root) return;
    const target = root.querySelector<HTMLElement>('#how-it-works');
    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }
}
