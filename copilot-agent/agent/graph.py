"""Build and compile the LangGraph clinical co-pilot graph.

Wiring only — node implementations live in ``agent.nodes``.

Topology::

    supervisor -> route_from_supervisor:
                    intake_extractor   -> supervisor (loop)
                    evidence_retriever -> supervisor (loop)
                    answer_assembler   -> END
"""
from __future__ import annotations

import functools
import logging
from typing import Any, Callable

import anthropic
import chromadb
from langgraph.graph import END, StateGraph
from rank_bm25 import BM25Okapi

from agent.nodes import (
    GraphDeps,
    answer_assembler_node,
    evidence_retriever_node,
    intake_extractor_node,
    route_from_supervisor,
    supervisor_node,
)
from agent.supervisor import AgentState
from rag.indexer import GuidelineChunk

logger = logging.getLogger(__name__)


def build_graph(
    anthropic_client: anthropic.AsyncAnthropic,
    cohere_client: Any | None,
    bm25: BM25Okapi,
    bm25_chunks: list[GuidelineChunk],
    chroma_collection: chromadb.Collection,
    get_extraction: Callable[[int], dict | None] | None = None,
) -> Any:
    deps = GraphDeps(
        anthropic_client=anthropic_client,
        cohere_client=cohere_client,
        bm25=bm25,
        bm25_chunks=bm25_chunks,
        chroma_collection=chroma_collection,
        get_extraction=get_extraction,
    )

    workflow = StateGraph(AgentState)
    workflow.add_node("supervisor", functools.partial(supervisor_node, deps=deps))
    workflow.add_node("intake_extractor", functools.partial(intake_extractor_node, deps=deps))
    workflow.add_node("evidence_retriever", functools.partial(evidence_retriever_node, deps=deps))
    workflow.add_node("answer_assembler", functools.partial(answer_assembler_node, deps=deps))

    workflow.set_entry_point("supervisor")
    workflow.add_conditional_edges("supervisor", route_from_supervisor)

    # Workers loop back to supervisor so it can dispatch any remaining workers
    workflow.add_edge("intake_extractor", "supervisor")
    workflow.add_edge("evidence_retriever", "supervisor")

    # answer_assembler is terminal
    workflow.add_edge("answer_assembler", END)

    return workflow.compile()
