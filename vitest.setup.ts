// Runs before test files import $lib/config, so config-dependent routes read and
// write a scratch file instead of the user's real data/config.json.
import path from 'node:path';

process.env.LITECHAT_CONFIG = path.join(process.cwd(), 'data', 'test-config.json');
