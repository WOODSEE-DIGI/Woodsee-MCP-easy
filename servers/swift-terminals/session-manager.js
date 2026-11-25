import { spawn } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
class TerminalSession extends EventEmitter {
    id;
    shell;
    cwd;
    process;
    stdoutBuffer = [];
    stderrBuffer = [];
    combinedBuffer = [];
    maxBufferLines = 1000;
    sessionDir;
    outputFile;
    created;
    constructor(id, shell, cwd, env) {
        super();
        this.id = id;
        this.shell = shell;
        this.cwd = cwd;
        this.created = new Date();
        this.setupSessionDirectory();
        this.process = spawn(shell, [], {
            cwd,
            env: { ...process.env, ...env },
            stdio: ["pipe", "pipe", "pipe"]
        });
        this.setupEventHandlers();
    }
    setupSessionDirectory() {
        try {
            const baseDir = "/tmp/mcp-terminals";
            this.sessionDir = path.join(baseDir, this.id);
            // Create session directory
            fs.mkdirSync(this.sessionDir, { recursive: true });
            // Create output file stream
            this.outputFile = fs.createWriteStream(path.join(this.sessionDir, "output.log"));
            // Write initial metadata
            this.updateMetadata();
        }
        catch (error) {
            console.error(`Failed to setup session directory for ${this.id}: ${error}`);
            throw error;
        }
    }
    updateMetadata() {
        try {
            const metadata = {
                id: this.id,
                shell: this.shell,
                cwd: this.cwd,
                status: this.isAlive() ? "running" : "stopped",
                created: this.created.toISOString(),
                lastActivity: new Date().toISOString()
            };
            fs.writeFileSync(path.join(this.sessionDir, "metadata.json"), JSON.stringify(metadata, null, 2));
        }
        catch (error) {
            console.error(`Failed to update metadata for session ${this.id}: ${error}`);
        }
    }
    setupEventHandlers() {
        this.process.stdout?.on("data", (data) => {
            const output = data.toString();
            this.addToStdoutBuffer(output);
            this.emit("stdout", output);
            this.emit("output", output); // Keep backward compatibility
        });
        this.process.stderr?.on("data", (data) => {
            const output = data.toString();
            this.addToStderrBuffer(output);
            this.emit("stderr", output);
            this.emit("output", output); // Keep backward compatibility
        });
        this.process.on("close", (code) => {
            this.emit("close", code);
        });
        this.process.on("error", (error) => {
            this.emit("error", error);
        });
    }
    addToStdoutBuffer(output) {
        try {
            const lines = output.split("\n");
            this.stdoutBuffer.push(...lines);
            if (this.stdoutBuffer.length > this.maxBufferLines) {
                this.stdoutBuffer = this.stdoutBuffer.slice(-this.maxBufferLines);
            }
            // Add to combined buffer
            this.combinedBuffer.push({ type: 'stdout', content: output, timestamp: Date.now() });
            if (this.combinedBuffer.length > this.maxBufferLines) {
                this.combinedBuffer = this.combinedBuffer.slice(-this.maxBufferLines);
            }
            // Write to file
            this.outputFile.write(output);
            this.updateMetadata();
        }
        catch (error) {
            console.error(`Failed to add stdout buffer for session ${this.id}: ${error}`);
        }
    }
    addToStderrBuffer(output) {
        try {
            const lines = output.split("\n");
            this.stderrBuffer.push(...lines);
            if (this.stderrBuffer.length > this.maxBufferLines) {
                this.stderrBuffer = this.stderrBuffer.slice(-this.maxBufferLines);
            }
            // Add to combined buffer
            this.combinedBuffer.push({ type: 'stderr', content: output, timestamp: Date.now() });
            if (this.combinedBuffer.length > this.maxBufferLines) {
                this.combinedBuffer = this.combinedBuffer.slice(-this.maxBufferLines);
            }
            // Write to file with stderr prefix
            this.outputFile.write(`[STDERR] ${output}`);
            this.updateMetadata();
        }
        catch (error) {
            console.error(`Failed to add stderr buffer for session ${this.id}: ${error}`);
        }
    }
    async execute(command) {
        // Log the command being executed to the output file
        const commandLine = `$ ${command}\n`;
        this.outputFile.write(commandLine);
        this.addToStdoutBuffer(commandLine);
        return new Promise((resolve) => {
            let stdout = "";
            let stderr = "";
            const startTime = Date.now();
            const onStdout = (data) => {
                stdout += data;
            };
            const onStderr = (data) => {
                stderr += data;
            };
            this.on("stdout", onStdout);
            this.on("stderr", onStderr);
            // Send command
            this.process.stdin?.write(command + "\n");
            // Update last output time when we get data
            const updateTime = () => {
                lastOutputTime = Date.now();
            };
            this.on("stdout", updateTime);
            this.on("stderr", updateTime);
            // Wait for output or timeout
            const timeout = setTimeout(() => {
                this.off("stdout", onStdout);
                this.off("stderr", onStderr);
                this.off("stdout", updateTime);
                this.off("stderr", updateTime);
                resolve({
                    stdout: stdout || "",
                    stderr: stderr || "",
                    combined: stdout + stderr,
                    exitCode: undefined
                });
            }, 5000);
            // Simple heuristic: if no new output for 500ms, consider command done
            let lastOutputTime = startTime;
            const checkComplete = setInterval(() => {
                if (Date.now() - lastOutputTime > 500) {
                    clearInterval(checkComplete);
                    clearTimeout(timeout);
                    this.off("stdout", onStdout);
                    this.off("stderr", onStderr);
                    this.off("stdout", updateTime);
                    this.off("stderr", updateTime);
                    resolve({
                        stdout,
                        stderr,
                        combined: stdout + stderr,
                        exitCode: undefined
                    });
                }
            }, 100);
        });
    }
    getOutput(lines, stream = 'all') {
        switch (stream) {
            case 'stdout':
                return this.getStdout(lines);
            case 'stderr':
                return this.getStderr(lines);
            case 'all':
            default:
                const combinedLines = lines
                    ? this.combinedBuffer.slice(-lines)
                    : this.combinedBuffer;
                return combinedLines.map(entry => entry.content).join("");
        }
    }
    getStdout(lines) {
        const outputLines = lines
            ? this.stdoutBuffer.slice(-lines)
            : this.stdoutBuffer;
        return outputLines.join("\n");
    }
    getStderr(lines) {
        const outputLines = lines
            ? this.stderrBuffer.slice(-lines)
            : this.stderrBuffer;
        return outputLines.join("\n");
    }
    getInfo() {
        return {
            id: this.id,
            shell: this.shell,
            cwd: this.cwd,
            status: this.isAlive() ? "running" : "stopped",
            created: this.created,
            lastActivity: new Date()
        };
    }
    isAlive() {
        return this.process && !this.process.killed && this.process.exitCode === null;
    }
    destroy() {
        if (this.isAlive()) {
            this.process.kill("SIGTERM");
            setTimeout(() => {
                if (this.isAlive()) {
                    this.process.kill("SIGKILL");
                }
                // Move directory cleanup here after process is definitely dead
                this.cleanupSessionDirectory();
            }, 5000);
        }
        else {
            // If process is already dead, clean up immediately
            this.cleanupSessionDirectory();
        }
        // Close file stream
        this.outputFile.end();
        // Update metadata to show stopped status
        this.updateMetadata();
        this.removeAllListeners();
    }
    cleanupSessionDirectory() {
        try {
            fs.rmSync(this.sessionDir, { recursive: true, force: true });
        }
        catch (error) {
            console.warn(`Failed to clean up session directory for ${this.id}: ${error}`);
        }
    }
}
export class SessionManager {
    sessions = new Map();
    defaultSession;
    createSession(id, options = {}) {
        if (this.sessions.has(id)) {
            throw new Error(`Session '${id}' already exists`);
        }
        const session = new TerminalSession(id, options.shell || process.env.SHELL || "/bin/bash", options.cwd || process.cwd(), options.env || {});
        this.sessions.set(id, session);
        if (!this.defaultSession) {
            this.defaultSession = id;
        }
        return session.getInfo();
    }
    getSession(id) {
        const session = this.sessions.get(id);
        if (!session) {
            throw new Error(`Session '${id}' not found`);
        }
        if (!session.isAlive()) {
            throw new Error(`Session '${id}' is not running`);
        }
        return session;
    }
    listSessions() {
        return Array.from(this.sessions.values()).map(session => session.getInfo());
    }
    async executeInSession(sessionId, command) {
        const session = this.getSession(sessionId);
        return session.execute(command);
    }
    getSessionOutput(sessionId, lines, stream) {
        const session = this.getSession(sessionId);
        return session.getOutput(lines, stream);
    }
    getSessionStdout(sessionId, lines) {
        const session = this.getSession(sessionId);
        return session.getStdout(lines);
    }
    getSessionStderr(sessionId, lines) {
        const session = this.getSession(sessionId);
        return session.getStderr(lines);
    }
    destroySession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        session.destroy();
        this.sessions.delete(sessionId);
        if (this.defaultSession === sessionId) {
            this.defaultSession = this.sessions.keys().next().value;
        }
        return true;
    }
    setDefaultSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        this.defaultSession = sessionId;
    }
    getDefaultSession() {
        return this.defaultSession;
    }
    cleanup() {
        for (const session of this.sessions.values()) {
            session.destroy();
        }
        this.sessions.clear();
    }
}
//# sourceMappingURL=session-manager.js.map