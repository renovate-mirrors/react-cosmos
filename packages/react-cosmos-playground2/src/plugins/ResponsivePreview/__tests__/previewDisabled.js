// @flow

import React from 'react';
import { render } from 'react-testing-library';
import { loadPlugins, Slot } from 'react-plugin';
import {
  cleanup,
  mockConfig,
  mockState,
  mockMethod
} from '../../../testHelpers/plugin';
import { register } from '..';

afterEach(cleanup);

const initialRendererState = { primaryRendererId: null, renderers: {} };

function registerTestPlugins() {
  register();
  mockConfig('core', { projectId: 'mockProjectId' });
  mockConfig('renderer', { webUrl: 'mockRendererUrl' });
  mockState('router', { urlParams: { fixturePath: 'fooFixture.js' } });
  mockState('renderer', initialRendererState);
  mockMethod('renderer.getPrimaryRendererState', () => null);
}

function loadTestPlugins() {
  loadPlugins({
    state: { responsivePreview: { enabled: false, viewport: null } }
  });

  return render(
    <Slot name="rendererPreviewOuter">
      <div data-testid="previewMock" />
    </Slot>
  );
}

it('renders children of "rendererPreviewOuter" slot', () => {
  registerTestPlugins();

  const { getByTestId } = loadTestPlugins();
  getByTestId('previewMock');
});

it('does not render responsive header', () => {
  registerTestPlugins();

  const { queryByTestId } = loadTestPlugins();
  expect(queryByTestId('responsiveHeader')).toBeNull();
});
