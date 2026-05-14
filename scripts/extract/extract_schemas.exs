# Extracts component schemas from petal_components and emits JSON.
#
# Run from scripts/extract/:
#   mix deps.get
#   mix run extract_schemas.exs
#
# Phoenix.Component generates __components__/0 on any module with attr/slot
# declarations, returning a map keyed by function name. We walk every loaded
# PetalComponents.* module, pull that metadata, and write it to ../../src/schemas.json.

defmodule SchemaExtractor do
  @output_path Path.join([__DIR__, "..", "..", "src", "schemas.json"])

  # Modules to skip — icon packs are huge and not useful for AI suggestion.
  @skip_modules [
    PetalComponents.HeroiconsV1.Outline,
    PetalComponents.HeroiconsV1.Solid,
    PetalComponents.Svg,
    PetalComponents.Helpers,
    PetalComponents.PaginationInternal
  ]

  def run do
    {:ok, modules} = :application.get_key(:petal_components, :modules)

    candidates =
      modules
      |> Enum.filter(&petal_module?/1)
      |> Enum.reject(&(&1 in @skip_modules))

    Enum.each(candidates, &Code.ensure_loaded/1)

    components =
      candidates
      |> Enum.flat_map(&extract_components/1)
      |> Enum.sort_by(& &1.name)

    output = %{
      version: petal_components_version(),
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      components: components
    }

    File.mkdir_p!(Path.dirname(@output_path))
    File.write!(@output_path, Jason.encode!(output, pretty: true))

    IO.puts("Wrote #{length(components)} components to #{@output_path}")
  end

  defp petal_module?(module) do
    module
    |> Module.split()
    |> List.starts_with?(["PetalComponents"])
  end

  defp extract_components(module) do
    if function_exported?(module, :__components__, 0) do
      module.__components__()
      |> Enum.map(fn {name, meta} -> build_component(module, name, meta) end)
    else
      []
    end
  end

  defp build_component(module, name, meta) do
    %{
      name: to_string(name),
      module: inspect(module),
      kind: meta[:kind] || :def,
      attrs: Enum.map(meta[:attrs] || [], &build_attr/1),
      slots: Enum.map(meta[:slots] || [], &build_slot/1)
    }
  end

  defp build_attr(attr) do
    %{
      name: to_string(attr.name),
      type: inspect(attr.type),
      required: attr.required || false,
      default: inspect_safe(attr[:opts][:default]),
      values: attr[:opts][:values],
      doc: attr.doc
    }
  end

  defp build_slot(slot) do
    %{
      name: to_string(slot.name),
      required: slot.required || false,
      doc: slot.doc,
      attrs: Enum.map(slot[:attrs] || [], &build_attr/1)
    }
  end

  defp inspect_safe(nil), do: nil
  defp inspect_safe(value), do: inspect(value)

  defp petal_components_version do
    case Application.spec(:petal_components, :vsn) do
      nil -> "unknown"
      vsn -> to_string(vsn)
    end
  end
end

SchemaExtractor.run()
