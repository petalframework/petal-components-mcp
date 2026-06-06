defmodule PetalComponentsMcp.Extract.MixProject do
  use Mix.Project

  # Tiny mix project that exists only to pull petal_components from Hex
  # so we can introspect its Phoenix.Component schemas. The actual MCP
  # server is the TypeScript service in ../../.

  def project do
    [
      app: :petal_components_mcp_extract,
      version: "0.1.0",
      elixir: "~> 1.14",
      deps: deps()
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  defp deps do
    [
      {:petal_components, "~> 4.0"},
      {:jason, "~> 1.4"}
    ]
  end
end
