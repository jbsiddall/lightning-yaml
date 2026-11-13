export interface CampaignOptions {
  samples: number;
  seed: number;
  extended: boolean;
  strict: boolean;
  replay?: string;
  output?: string;
}

export function parseArguments(args: string[]): CampaignOptions {
  const options: CampaignOptions = {
    samples: 20000,
    seed: 20261011,
    extended: false,
    strict: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index]!;
    if (name === "--") continue;
    if (seen.has(name)) throw new Error(`Repeated argument: ${name}`);
    seen.add(name);
    if (name === "--extended" || name === "--strict") {
      options[name.slice(2) as "extended" | "strict"] = true;
      continue;
    }
    if (!["--samples", "--seed", "--replay", "--output"].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${name}`);
    if (name === "--samples" || name === "--seed") {
      if (!/^-?\d+$/.test(value))
        throw new Error(`Invalid integer for ${name}: ${value}`);
      const number = Number(value);
      if (!Number.isSafeInteger(number))
        throw new Error(`Invalid integer for ${name}: ${value}`);
      if (name === "--samples") {
        if (number < 0 || number > 200000)
          throw new Error("--samples must be between 0 and 200000");
        options.samples = number;
      } else {
        if (number < -2147483648 || number > 2147483647)
          throw new Error("--seed must be a signed 32-bit integer");
        options.seed = number;
      }
    } else {
      options[name.slice(2) as "replay" | "output"] = value;
    }
  }
  if (options.replay && options.extended)
    throw new Error("--replay cannot be combined with --extended");
  return options;
}
