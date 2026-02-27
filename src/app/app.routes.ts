import { Routes } from '@angular/router';

export const routes: Routes = [{
    path: '',
    redirectTo: '/landing',
    pathMatch: 'full'
}, {
    path: 'landing',
    loadComponent: () => import('./pages/landing/landing').then(c => c.Landing)
}, {
    path: 'time-shards',
    loadComponent: () => import('./pages/time-shards/time-shards').then(c => c.TimeShards)
}, {
    path: 'guide',
    loadComponent: () => import('./pages/guide/guide').then(c => c.Guide)
}, {
    path: 'privacy',
    loadComponent: () => import('./pages/privacy/privacy').then(c => c.Privacy)
}];
