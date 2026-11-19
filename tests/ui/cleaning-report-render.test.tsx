import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompletionReportContent } from '../../src/components/bloom/cleaning-report';

const report = { jobId: 'j', propertyName: '3628 Trumbull', date: '2026-11-19', receipt: null };

test('completed report names the cleaners who did the job', () => {
  const html = renderToStaticMarkup(<CompletionReportContent report={{ ...report, cleaners: [{ id: 'c1', displayName: 'Alexis Moore', avatarUrl: null }, { id: 'c2', displayName: 'Sam Patel', avatarUrl: 'https://img.example/sam.png' }] }} />);
  assert.match(html, /Cleaned by/);
  assert.match(html, /Alexis Moore/);
  assert.match(html, /Sam Patel/);
  assert.match(html, /sam\.png/);
});

test('report without assigned cleaners omits the row', () => {
  assert.doesNotMatch(renderToStaticMarkup(<CompletionReportContent report={report} />), /Cleaned by/);
  assert.doesNotMatch(renderToStaticMarkup(<CompletionReportContent report={{ ...report, cleaners: [] }} />), /Cleaned by/);
});
