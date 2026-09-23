import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Publish the prerendered public page independently of the Render API.
// Keep the project's actual hostname untouched; Pages is an alternate URL.
const output = path.resolve('web-dist');
const prefix = '/Bunker-admin';
const renderOrigin = 'https://bunker-vdk.ru';

function assetsAtPages(html) {
  return html.replaceAll('/assets/', prefix + '/assets/');
}
function dynamicLinksAtRender(html) {
  return html.replace(
    /href="\/(catalog|admin|profile|proposals|users|tips|achievements|releases)(?=[/?#"])/g,
    (_, route) => `href="${renderOrigin}/${route}`,
  );
}

const landing = await readFile(path.join(output, 'landing.html'), 'utf8');
if (!landing.includes('data-prerendered="landing"')) {
  throw Error('The landing must be prerendered before publishing to Pages');
}
let homepage = dynamicLinksAtRender(assetsAtPages(landing));
homepage = homepage.replaceAll('href="/"', `href="${prefix}/"`);
homepage = homepage.replaceAll('href="/qr"', `href="${prefix}/qr/"`);
await writeFile(path.join(output, 'index.html'), homepage);

const qr = await readFile(path.join(output, 'qr.html'), 'utf8');
await mkdir(path.join(output, 'qr'), { recursive: true });
await writeFile(path.join(output, 'qr', 'index.html'), assetsAtPages(qr));
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Prepared public landing and QR page for ' + prefix + '/');
