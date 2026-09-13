// Mini-client MQTT 3.1.1 (sans dépendance) — preuve C1 : s'abonner en
// ANONYME au broker global WIS2 de Météo-France et lister les topics
// aviation réellement diffusés (notifications WIS2 = JSON avec URL des
// données IWXXM). Usage : node test/_diag-wis2.mjs [durée_s] [topic]
import net from 'node:net';

const HOST = 'globalbroker.meteo.fr', PORT = 1883;
const DUREE_S = parseInt(process.argv[2] || '25', 10);
const TOPIC = process.argv[3] || 'origin/a/wis2/fr-meteo-france/#';

const enc = (s) => Buffer.from(s, 'utf8');
const remLen = (n) => {
    const b = [];
    do { let x = n % 128; n = Math.floor(n / 128); if (n > 0) x |= 0x80; b.push(x); } while (n > 0);
    return Buffer.from(b);
};

// ---- CONNECT (MQTT 3.1.1, anonyme) ----
const cid = enc('zcode-diag-' + Date.now());
const vh = Buffer.concat([Buffer.from([0, 4]), enc('MQTT'), Buffer.from([4 /*3.1.1*/, 0 /* clean session */]), Buffer.from([0, 30])]);
const payload = Buffer.concat([Buffer.from([0, cid.length]), cid]);
const connect = Buffer.concat([Buffer.from([0x10]), remLen(vh.length + payload.length), vh, payload]);

// ---- SUBSCRIBE ----
const topic = enc(TOPIC);
const subBody = Buffer.concat([Buffer.from([0, 1 /* msg id */]), Buffer.from([0, topic.length]), topic, Buffer.from([0 /* QoS 0 */])]);
const subscribe = Buffer.concat([Buffer.from([0x82]), remLen(subBody.length), subBody]);

const sock = net.connect({ host: HOST, port: PORT }, () => {
    sock.write(connect);
});
sock.setTimeout(15000);

let buf = Buffer.alloc(0);
const topics = new Map();
let connack = false;

sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // CONNACK
    if (!connack && buf.length >= 4 && (buf[0] >> 4) === 2) {
        connack = true;
        console.log('CONNACK code:', buf[3], buf[3] === 0 ? '(accepté — anonyme OK)' : '(refusé)');
        sock.write(subscribe);
        buf = buf.slice(5);
        return;
    }
    // PUBLISH (QoS 0) : type 3
    while (buf.length >= 2 && (buf[0] >> 4) === 3) {
        let i = 1, mult = 1, len = 0, byte;
        do { byte = buf[i++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
        const tLen = buf.readUInt16BE(i);
        const topicStr = buf.slice(i + 2, i + 2 + tLen).toString();
        const body = buf.slice(i + 2 + tLen, 1 + (i - 1) + len + (i - 1));
        const rest = buf.slice(1 + (i - 1) + len);
        try {
            const j = JSON.parse(body.toString());
            topics.set(topicStr, (topics.get(topicStr) || 0) + 1);
            if (topics.size <= 12 || j.data_id?.includes?.('SIGMET') || /sigmet/i.test(topicStr)) {
                console.log('TOPIC:', topicStr);
                console.log('  url:', j.url || j.links?.[0]?.href || '(sans url)', '| rel:', j.rel || '');
            }
        } catch {   }
        buf = rest;
    }
    if (buf.length && (buf[0] >> 4) === 9) console.log('SUBACK reçu');
    buf = buf.length > 65536 ? Buffer.alloc(0) : buf;
});
sock.on('error', (e) => { console.error('ERREUR:', e.message); process.exit(1); });
sock.on('timeout', () => { console.error('TIMEOUT (pas de CONNACK)'); process.exit(1); });

setTimeout(() => {
    console.log('--- BILAN:', topics.size, 'topics distincts en', DUREE_S, 's ---');
    for (const t of [...topics.keys()].slice(0, 40)) console.log(' ', t, '×', topics.get(t));
    sock.destroy();
    process.exit(0);
}, DUREE_S * 1000);
