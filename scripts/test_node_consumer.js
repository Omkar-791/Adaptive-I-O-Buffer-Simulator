const { spawn } = require('child_process');
const path = require('path');

function runTest(args, description) {
    return new Promise((resolve) => {
        console.log(`\n========================================`);
        console.log(`TEST: ${description}`);
        console.log(`Command: adaptive_io_sim.exe ${args.join(' ')}`);
        console.log(`========================================`);

        const exePath = path.resolve(__dirname, '..', 'build', 'adaptive_io_sim.exe');
        const child = spawn(exePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdoutRaw = '';
        let stderrRaw = '';
        let parsedLineObjects = [];
        let malformedLines = [];
        let wholeJsonParsed = null;

        child.stdout.on('data', (chunk) => {
            stdoutRaw += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderrRaw += chunk.toString();
        });

        child.on('close', (exitCode) => {
            console.log(`Process exited with code: ${exitCode}`);
            console.log(`Stderr output:\n${stderrRaw.trim() || '(empty)'}`);
            console.log(`Raw stdout byte length: ${stdoutRaw.length}`);

            // Attempt 1: Line-by-line NDJSON parsing
            const lines = stdoutRaw.split(/\r?\n/).filter(line => line.trim().length > 0);
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    parsedLineObjects.push(obj);
                } catch (e) {
                    malformedLines.push({ line, error: e.message });
                }
            }

            // Attempt 2: Whole document JSON parsing
            try {
                if (stdoutRaw.trim().length > 0) {
                    wholeJsonParsed = JSON.parse(stdoutRaw);
                }
            } catch (e) {
                // whole doc parse error
            }

            console.log(`Line-by-line parsing:`);
            console.log(`  Total non-empty lines: ${lines.length}`);
            console.log(`  Valid JSON lines parsed: ${parsedLineObjects.length}`);
            console.log(`  Malformed lines: ${malformedLines.length}`);

            console.log(`Whole document parsing:`);
            console.log(`  Parsed successfully: ${wholeJsonParsed !== null}`);
            if (wholeJsonParsed) {
                console.log(`  Root keys: ${Object.keys(wholeJsonParsed).join(', ')}`);
                console.log(`  Has "type" or "messageType": ${Boolean(wholeJsonParsed.type || wholeJsonParsed.messageType || wholeJsonParsed.eventType)}`);
            }

            resolve({
                exitCode,
                stdoutRaw,
                stderrRaw,
                linesCount: lines.length,
                validJsonLines: parsedLineObjects.length,
                malformedLinesCount: malformedLines.length,
                wholeJsonParsed: wholeJsonParsed !== null,
                parsedObj: wholeJsonParsed
            });
        });
    });
}

async function main() {
    // Case A: Valid simulation
    await runTest(['--streams', '2', '--budget', '16', '--requests', '10', '--json'], 'Case A: Valid Simulation');

    // Case B: Invalid configuration
    await runTest(['--min-payload', '4096', '--max-payload', '512', '--json'], 'Case B: Invalid Configuration');

    // Case C: Insufficient budget
    await runTest(['--streams', '5', '--budget', '4', '--json'], 'Case C: Insufficient Global Buffer Budget');

    // Case D: Invalid CLI argument
    await runTest(['--streams', '-5', '--json'], 'Case D: Invalid Negative CLI Argument');

    // Case E: Missing parameter argument
    await runTest(['--budget', '--json'], 'Case E: Missing Parameter Value');

    // Case F: Phase 4 Burst Workload
    await runTest(['--workload', 'burst', '--burst-interval', '1', '--burst-length', '5', '--requests', '20', '--json'], 'Case F: Phase 4 Burst Workload');

    // Case G: Phase 4 JSON Config File (Heterogeneous)
    await runTest(['--config', 'configs/workload_heterogeneous.json', '--json'], 'Case G: Phase 4 Heterogeneous Workload JSON Config');
}

main();
