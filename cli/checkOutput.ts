import { StringDecoder } from "node:string_decoder";
import { CHECK_OUTPUT_OMISSION } from "../src/constants/check.ts";
import type { CheckCapture } from "../src/types/check.ts";

type Pipe = "stdout" | "stderr";

function safeHead(text: string, length: number): string {
  const value: string = text.slice(0, length);
  return /[\uD800-\uDBFF]$/u.test(value) ? value.slice(0, -1) : value;
}

function safeTail(text: string, length: number): string {
  if (!length) return "";
  const value: string = text.slice(-length);
  return /^[\uDC00-\uDFFF]/u.test(value) ? value.slice(1) : value;
}

/** Keeps startup context and final errors without retaining arbitrary amounts of output. */
class BoundedText {
  private head: string = "";
  private tail: string = "";
  private seen: number = 0;
  private readonly limit: number;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  constructor(limit: number) {
    this.limit = limit;
    this.headLimit = Math.floor((limit - CHECK_OUTPUT_OMISSION.length) / 2);
    this.tailLimit = limit - CHECK_OUTPUT_OMISSION.length - this.headLimit;
  }

  get truncated(): boolean {
    return this.seen > this.limit;
  }

  append(value: string): void {
    if (!value.length) return;
    const wasTruncated: boolean = this.truncated;
    this.seen += value.length;
    if (!this.truncated) {
      this.head += value;
      return;
    }
    if (!wasTruncated) {
      this.tail = this.head;
      this.head = this.head.length >= this.headLimit
        ? safeHead(this.head, this.headLimit) : safeHead(this.head + value.slice(0, this.headLimit), this.headLimit);
    }
    this.tail = safeTail(this.tail + safeTail(value, this.tailLimit), this.tailLimit);
  }

  value(): string {
    return this.truncated ? this.head + CHECK_OUTPUT_OMISSION + this.tail : this.head;
  }
}

export interface CheckOutputCollector {
  append(pipe: Pipe, bytes: Buffer): void;
  finish(): CheckCapture;
}

export function createCheckOutput(limit: number): CheckOutputCollector {
  const decoders: Record<Pipe, StringDecoder> = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  const pipes: Record<Pipe, BoundedText> = { stdout: new BoundedText(limit), stderr: new BoundedText(limit) };
  const combined: BoundedText = new BoundedText(limit);
  function record(pipe: Pipe, text: string): void {
    pipes[pipe].append(text);
    combined.append(text);
  }
  return {
    append(pipe: Pipe, bytes: Buffer): void {
      record(pipe, decoders[pipe].write(bytes));
    },
    finish(): CheckCapture {
      record("stdout", decoders.stdout.end());
      record("stderr", decoders.stderr.end());
      return {
        stdout: pipes.stdout.value(), stderr: pipes.stderr.value(), output: combined.value(),
        outputTruncated: combined.truncated,
      };
    },
  };
}
