const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 8000;

const server = http.createServer((req, res) => {
    console.log(`Request for ${req.url}`);

    // Remove query strings and fragments
    let cleanUrl = req.url.split('?')[0].split('#')[0];

    // The URL arrives percent-encoded, so a file with a space in its name
    // reaches us as New%20Template.png and has to be decoded before it will
    // match anything on disk. Without this the hero wordmark 404s locally even
    // though the file is right there.
    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(cleanUrl);
    } catch (e) {
        // Malformed escape sequence, e.g. a stray % that decodeURIComponent
        // throws a URIError on. Never let that take the whole server down.
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('400 Bad Request');
        return;
    }

    if (decodedUrl === '/') {
        decodedUrl = '/index.html';
    }

    // Decoding is what makes the containment check below necessary: `..%2f`
    // means nothing to the old string concatenation, but decodes to `../` and
    // would walk straight out of the site root. Resolve first, then refuse
    // anything that landed outside.
    const root = __dirname;
    const filePath = path.resolve(root, '.' + decodedUrl);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        console.log(`Refused traversal: ${decodedUrl}`);
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        // image/jpg is not a real media type. Browsers sniff past it, but
        // anything stricter would not.
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            // EISDIR is a request for a directory, e.g. /assets. It is a miss,
            // not a server fault, so it must not fall through to the 500.
            if (error.code == 'ENOENT' || error.code == 'EISDIR') {
                console.log(`File not found: ${filePath}`);
                // Resolved against the site root rather than the working
                // directory, so the 404 page is still found when the server is
                // started from somewhere else.
                fs.readFile(path.join(root, '404.html'), (error, content) => {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end(content || '404 Not Found', 'utf-8');
                });
            }
            else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        }
        else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(port, () => {
    console.log(`Server running at http://127.0.0.1:${port}/`);
});
