import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimeShards } from './time-shards';

describe('TimeShards', () => {
  let component: TimeShards;
  let fixture: ComponentFixture<TimeShards>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimeShards]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TimeShards);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
