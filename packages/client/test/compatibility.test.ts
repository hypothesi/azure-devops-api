import { describe, expect, it } from 'vite-plus/test';
import packageJSON from '../package.json';
import {
   getCompatibility,
   getEntryPoint,
   isProductID,
   isSupportedApiVersion,
   SUPPORTED_API_VERSIONS,
} from '../src/entries/compatibility';
import * as root from '../src/entries/index';

const NON_CLIENT_EXPORTS = new Set(['.', './compatibility', './package.json']);

describe('compatibility', () => {
   it('reports the client version from package.json', () => {
      const { clientVersion } = getCompatibility();

      expect(clientVersion).toBe(packageJSON.version);
   });

   it('lists the supported API versions lowest first, matching package.json', () => {
      const supported = [...SUPPORTED_API_VERSIONS];

      expect(supported).toEqual(['7.0', '7.1']);
      expect(supported).toEqual(packageJSON.azureDevOps.apiVersions);
   });

   it('gives every API version, product, and entry point an id and a readable label', () => {
      const { apiVersions, products, entryPoints } = getCompatibility(),
         items = [...apiVersions, ...products, ...entryPoints];

      expect(
         items.every((item) => {
            return item.id.length > 0 && item.label.length > 0 && item.label !== item.id;
         }),
      ).toBe(true);
      expect(
         apiVersions.map((version) => {
            return version.label;
         }),
      ).toEqual(['Azure DevOps REST API 7.0', 'Azure DevOps REST API 7.1']);
   });

   it('has one entry point for every client subpath export, and no others', () => {
      const exported = Object.keys(packageJSON.exports)
            .filter((key) => {
               return !NON_CLIENT_EXPORTS.has(key);
            })
            .toSorted(),
         listed = getCompatibility()
            .entryPoints.map((entryPoint) => {
               return entryPoint.importPath.replace('@hypothesi/azure-devops-api', '.');
            })
            .toSorted();

      expect(listed).toEqual(exported);
   });

   it('matches each entry point to the API version its client sends', () => {
      const entryPoint = getEntryPoint('server-2022');

      expect(entryPoint).toMatchObject({
         apiVersion: '7.0',
         importPath: '@hypothesi/azure-devops-api/server-2022',
         label: 'Azure DevOps Server 2022 (REST API 7.0)',
      });
      expect(entryPoint.products).toContain('server-2022');
      expect(getEntryPoint('7.1').products).not.toContain('server-2022');
   });

   it.each([
      ['7.1', true],
      ['7.0', true],
      ['7.2', false],
      ['6.0', false],
   ])('reports whether API version %s is supported', (value, expected) => {
      const result = isSupportedApiVersion(value);

      expect(result).toBe(expected);
   });

   it('checks product IDs', () => {
      const results = ['services', 'server', 'server-2022', 'server-2020'].map(isProductID);

      expect(results).toEqual([true, true, true, false]);
   });

   it('is available from the package root', () => {
      const fromRoot = root.getCompatibility();

      expect(fromRoot).toBe(getCompatibility());
   });
});
